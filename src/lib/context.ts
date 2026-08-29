import { SignJWT, jwtVerify } from 'jose';
import type { Context, GameProcess, GameStorage } from '../types';
import type { Env } from '../env';
import { glot, runCode } from './glot';

export function buildContext(opts: {
  env: Env;
  username: string;
  gameProcess: GameProcess;
  gameStorage: GameStorage;
  msg: (s: string) => void;
  content: (s: string) => void;
  award: (id: string) => void;
}): Context {
  const secret = new TextEncoder().encode(opts.env.JWT_SECRET);
  return {
    username: opts.username,
    gameProcess: opts.gameProcess,
    gameStorage: opts.gameStorage,
    msg: opts.msg,
    content: opts.content,
    award: opts.award,
    glot: (language, data) => glot(opts.env.GLOT_IO_API_KEY, language, data),
    runCode: (code, language, stdin) => runCode(opts.env.GLOT_IO_API_KEY, code, language, stdin),
    jwt: {
      sign: (payload) =>
        new SignJWT({ ...payload })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .sign(secret),
      verify: async (token) => {
        const { payload } = await jwtVerify(token, secret);
        return payload as Record<string, unknown>;
      },
    },
  };
}
