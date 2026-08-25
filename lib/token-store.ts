import { prisma } from "./prisma";

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function loadToken(provider: string): Promise<TokenData | null> {
  const row = await prisma.oAuthToken.findUnique({ where: { provider } });
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? "",
    expiresAt: row.expiresAt.getTime(),
  };
}

export async function persistToken(provider: string, token: TokenData): Promise<void> {
  await prisma.oAuthToken.upsert({
    where: { provider },
    create: {
      provider,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: new Date(token.expiresAt),
    },
    update: {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: new Date(token.expiresAt),
    },
  });
}

export async function clearToken(provider: string): Promise<void> {
  await prisma.oAuthToken.deleteMany({ where: { provider } });
}
