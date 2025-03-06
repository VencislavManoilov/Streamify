<template>
  <router-view />
</template>

<script>
export default {
  name: 'App',
}
</script>

<style>
body {
  margin: 0;
  background-color: black;
  color: white;
}
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a {
  text-decoration: none;
}

.vjs-fullscreen {
  height: 100% !important;
}
.vjs-fullscreen .vjs-control-bar {
  position: absolute !important;
  bottom: 0 !important;
  left: 0;
  right: 0;
  z-index: 1000;
}
</style>
