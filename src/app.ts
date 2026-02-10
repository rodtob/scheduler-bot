import * as dotenv from 'dotenv';
import { createBot, createProvider, createFlow, addKeyword, utils } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { MetaProvider as Provider } from '@builderbot/provider-meta'
import axios, { AxiosResponse } from "axios";

dotenv.config();
const PORT = process.env.PORT ?? 3008


const welcomeFlow = addKeyword(['hi', 'hello', 'hola'])
  .addAction(async (ctx, { provider, fallBack }) => {
    const phone = ctx.from.replace(/\D/g, '');

    // 1) Call your API to check if user exists + fetch lessons
    let response: AxiosResponse<any, any, {}>;
    try {
      response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/users?phone=${phone}&withLessons=true`
      );
    } catch (err) {
      console.error(err);
      return provider.sendText(ctx.from, "⚠️ Error contacting server.");
    }

    const { user, lessons } = response.data;

    // 2) If user does NOT exist → continue original onboarding
    if (!user) {
      return provider.sendText(
        ctx.from,
        [
          "🙌 Hello, welcome to El Desbande!",
        ].join("\n")
      );
    }

    // 3) If user exists → check their booked lessons
    if (!lessons || lessons.length === 0) {
      return provider.sendText(
        ctx.from,
        "👋 Welcome back! You are registered but have no booked lessons yet."
      );
    }

    // 4) Format lessons list for WhatsApp
    const formattedLessons = lessons
      .map((lesson: { date: string | number | Date; startTime: String; }) => {
        const date = new Date(lesson.date).toLocaleDateString("en-US");
        return `*Date: ${date}\n   Hour: ${lesson.startTime || "TBD"}`;
      })
      .join("\n\n");

    return provider.sendText(
      ctx.from,
      `📚 *Hi ${user.name} \n Your booked lessons:*\n\n${formattedLessons}`
    );
  });


const registerFlow = addKeyword<Provider, Database>(utils.setEvent('REGISTER_FLOW'))
    .addAnswer(`What is your name?`, { capture: true }, async (ctx, { state }) => {
        await state.update({ name: ctx.body })
    })
    .addAnswer('What is your age?', { capture: true }, async (ctx, { state }) => {
        await state.update({ age: ctx.body })
    })
    .addAction(async (_, { flowDynamic, state }) => {
        await flowDynamic(`${state.get('name')}, thanks for your information!: Your age: ${state.get('age')}`)
    })

const main = async () => {
    const adapterFlow = createFlow([welcomeFlow, registerFlow])
    const adapterProvider = createProvider(Provider, {
        jwtToken: process.env.jwtToken,
        numberId: process.env.numberId,
        verifyToken: process.env.verifyToken,
        version: process.env.version
    })
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    },{
      queue: {
        timeout: 20000,
        concurrencyLimit: 10
      }
    })

    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('REGISTER_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('SAMPLES', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    httpServer(+PORT)
}

main()
