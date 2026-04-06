// Universal link handler: https://app.hisaabo.in/auth/verify → /verify
// Expo Router groups (auth) out of the URL path, so /auth/verify has no
// matching route. This file exists solely to catch universal links and
// redirect to the real (auth)/verify screen.
export { default } from "../(auth)/verify";
