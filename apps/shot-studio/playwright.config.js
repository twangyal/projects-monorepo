import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:90000,workers:1,use:{baseURL:'http://127.0.0.1:4173',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},webServer:{command:'python3 -m http.server 4173 --bind 127.0.0.1',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI}});
