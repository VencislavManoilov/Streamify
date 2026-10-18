import { createApp } from 'vue'
import '@fontsource-variable/archivo/wdth.css'
import App from './App.vue'
import router from './router'
import { connection } from './connection'

connection.start()

createApp(App)
  .use(router)
  .mount('#app')
