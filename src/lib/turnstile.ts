/** secret 未配置时不启用 Turnstile（与 mijie 行为一致） */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined
): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  const formData = new FormData();
  formData.append('secret', secret);
  formData.append('response', token);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    body: formData,
    method: 'POST',
  });
  const outcome = (await res.json()) as { success?: boolean };
  return outcome.success === true;
}
