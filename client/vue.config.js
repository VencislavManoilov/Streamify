const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  devServer: {
    port: 3000,
    proxy: {
      '/captions': {
        target: 'http://localhost:8080', // Backend URL
        changeOrigin: true
      },
      '/subtitles': {
        target: 'http://localhost:8080', // Backend URL
        changeOrigin: true
      }
    }
  }
})
