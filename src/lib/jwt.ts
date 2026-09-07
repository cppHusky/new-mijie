import { SignJWT, jwtVerify } from 'jose';

export interface TokenPayload {
  sub: string;
  admin: number;
}

const enc = (secret: string) => new TextEncoder().encode(secret);

export async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  return new SignJWT({ admin: payload.admin })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .setProtectedHeader({ alg: 'HS256' })
    .sign(enc(secret));
}

/** 过期与无效均返回 null（前端收到 401 后自行跳登录） */
export async function verifyToken(secret: string, token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret));
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, admin: typeof payload.admin === 'number' ? payload.admin : 0 };
  } catch {
    return null;
  }
}
