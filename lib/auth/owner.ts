/** 修改时间：2026-09-17 | 文件说明：管理端 GitHub 身份白名单与会话校验 | edit by：Sliye */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/** 配置不完整时保持管理端关闭，不以本地模式绕过身份验证。 */
export function isOwnerAuthConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID &&
    process.env.AUTH_GITHUB_SECRET && process.env.OWNER_GITHUB_ID);
}

/** 官方：https://authjs.dev/getting-started/providers/github；JWT 只保留身份，不向浏览器暴露 OAuth token。 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  callbacks: {
    signIn({ account, profile }) {
      return isOwnerAuthConfigured() && account?.provider === "github" &&
        String(profile?.id) === process.env.OWNER_GITHUB_ID;
    },
    jwt({ token, account, profile }) {
      if (account?.provider === "github") token.ownerId = String(profile?.id);
      return token;
    },
    session({ session, token }) {
      session.user.id = typeof token.ownerId === "string" ? token.ownerId : "";
      return session;
    },
  },
});

/** 每次读取重新核对当前白名单，撤销配置后旧 Cookie 也不能继续访问。 */
export async function isOwner() {
  if (!isOwnerAuthConfigured()) return false;
  const session = await auth();
  return session?.user?.id === process.env.OWNER_GITHUB_ID;
}
