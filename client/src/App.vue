<template>
  <LoadingSpinner v-if="!ready" overlay label="Loading Streamify" />
  <router-view v-else />
  <ToastHost />
</template>

<script>
import LoadingSpinner from './components/LoadingSpinner.vue';
import ToastHost from './components/ToastHost.vue';

export default {
  name: 'App',
  components: {
    LoadingSpinner,
    ToastHost
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
  --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
}

/* The page itself carries the bottom edge of the background below: its colors from left to right, the same all
   the way down. Safari 26 on iOS draws no fixed layer under its floating toolbar, only the page, so this is what
   shows there and the background fades into it before it gets cut off. The plain color is the top edge's tone,
   for Safari to tint its status bar with */
html {
  background-color: #161837;
  background-image:
    var(--grain),
    linear-gradient(to right, #240f25 0%, #230f24 10%, #1e0d21 20%, #180c1d 30%, #130a1a 40%, #0d0916 50%, #0d0a1a 60%, #100c21 70%, #130f28 80%, #16112e 90%, #181231 100%);
}

body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.5;
}

/* Dusk over a dark room, spread over the whole screen: violet in the top left and bottom right corners,
   petrol teal down the right side, wine in the bottom left and a faint violet haze in the middle,
   with a fine grain on top that keeps the dark gradients from banding.
   It fades out at the bottom into the page's own background, which goes on under Safari's toolbar */
body::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  /* lvh is the viewport with the browser bars retracted, so the layer reaches the bottom of the screen
     on mobile browsers that do draw it under their toolbar */
  height: 100vh;
  height: 100lvh;
  pointer-events: none;
  /* Gone well before the top of Safari's toolbar, about 100px up from the bottom of the screen */
  mask-image: linear-gradient(to bottom, #000 calc(100% - 260px), transparent calc(100% - 120px));
  background:
    var(--grain),
    radial-gradient(ellipse 80% 70% at 5% 2%, rgba(92, 66, 196, 0.38), transparent 72%),
    radial-gradient(ellipse 62% 72% at 98% 18%, rgba(22, 108, 138, 0.32), transparent 72%),
    radial-gradient(ellipse 70% 55% at 52% 56%, rgba(64, 52, 150, 0.16), transparent 72%),
    radial-gradient(ellipse 75% 62% at 3% 100%, rgba(118, 36, 84, 0.3), transparent 72%),
    radial-gradient(ellipse 70% 60% at 100% 100%, rgba(92, 66, 196, 0.22), transparent 72%),
    linear-gradient(160deg, #0c0d1c 0%, #08091a 45%, #09070f 100%);
}

/* Its own stacking layer, so the whole page paints over the background above */
#app {
  isolation: isolate;
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
