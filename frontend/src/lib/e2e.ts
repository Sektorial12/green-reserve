export function isE2eTest() {
  return process.env.NEXT_PUBLIC_E2E_TEST === "true";
}
