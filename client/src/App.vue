<template>
  <LoadingSpinner v-if="!ready" overlay label="Loading Streamify" />
  <router-view v-else />
</template>

<script>
import LoadingSpinner from './components/LoadingSpinner.vue';

export default {
  name: 'App',
  components: {
    LoadingSpinner
  },
  data() {
    return {
      ready: false
    };
  },
  created() {
    // The first page waits for the session check, show the spinner until it's done
    this.$router.isReady().finally(() => {
      this.ready = true;
    });
  }
}
</script>

<style>
:root {
  color-scheme: dark;

  --bg: #06070d;
  --bg-elevated: #10121d;
  --surface: rgba(255, 255, 255, 0.06);
  --surface-strong: rgba(255, 255, 255, 0.1);
  --surface-hover: rgba(255, 255, 255, 0.15);
  --line: rgba(255, 255, 255, 0.1);
  --text: #eceef6;
  --text-muted: #a4a9be;
  --text-faint: #6d7288;
  --accent: #e9c37b;
  --dusk: #7d6cf0;
  --danger: #e5736b;

  --font: 'Archivo Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --gutter: clamp(16px, 4vw, 48px);
}

html {
  background: var(--bg);
}

/* Transparent on purpose: a body background would paint over the glow layers below */
body {
  margin: 0;
  min-height: 100vh;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.5;
}

/* Dusk over a dark room: a violet glow top left, petrol teal top right and a faint wine glow below */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 55% at 8% -10%, rgba(92, 66, 196, 0.34), transparent 64%),
    radial-gradient(ellipse 65% 50% at 96% -6%, rgba(22, 108, 138, 0.28), transparent 62%),
    radial-gradient(ellipse 90% 55% at 50% 116%, rgba(118, 36, 84, 0.2), transparent 66%),
    linear-gradient(180deg, #0b0c19 0%, #06070d 48%, #050509 100%);
}

/* Fine grain keeps the dark gradients from banding */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

#app {
  font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
  text-decoration: none;
}

button,
input {
  font-family: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
