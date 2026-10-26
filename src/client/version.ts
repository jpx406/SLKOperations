// The version shown on the sign-in page and in the header: package.json's version and the build stamp
// (20261026095131 → 2026-10-26 09:51 UTC). Local development shows "dev".

export const APP_VERSION = __APP_VERSION__;

export const BUILD_LABEL = /^\d{14}$/.test(__APP_BUILD__)
  ? `${__APP_BUILD__.slice(0, 4)}-${__APP_BUILD__.slice(4, 6)}-${__APP_BUILD__.slice(6, 8)} ${__APP_BUILD__.slice(8, 10)}:${__APP_BUILD__.slice(10, 12)} UTC`
  : __APP_BUILD__;

export const VERSION_TEXT = `Version ${APP_VERSION} · build ${BUILD_LABEL}`;
