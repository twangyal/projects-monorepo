import {defineConfig} from '@playwright/test';
const configuredPort=process.env.SHOT_TEST_PORT??'4173';
if(!/^\d{1,5}$/.test(configuredPort)||Number(configuredPort)<1||Number(configuredPort)>65535)throw Error('SHOT_TEST_PORT must be a port from 1 to 65535.');
const port=Number(configuredPort),baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({
  testDir:'tests/browser',timeout:90000,workers:1,
  use:{baseURL,trace:'retain-on-failure',launchOptions:{
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  }},
  webServer:{command:`python3 -m http.server ${port} --bind 127.0.0.1`,url:baseURL,reuseExistingServer:false,gracefulShutdown:{signal:'SIGTERM',timeout:10000}},
});
