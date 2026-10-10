<template>
    <svg class="avatar" :width="size" :height="size" viewBox="0 0 40 40" aria-hidden="true">
        <defs>
            <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" :stop-color="palette[0]" />
                <stop offset="1" :stop-color="palette[1]" />
            </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" :fill="`url(#${gradientId})`" />
        <ellipse cx="14.6" cy="17.2" rx="2.1" ry="2.7" fill="#fff" />
        <ellipse cx="25.4" cy="17.2" rx="2.1" ry="2.7" fill="#fff" />
        <path d="M12.6 24.4c2 3.1 4.5 4.5 7.4 4.5s5.4-1.4 7.4-4.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
    </svg>
</template>

<script>
// Every account gets its own color, picked from its name
const PALETTES = [
    ['#5d93ff', '#2f58d4'],
    ['#38c2ae', '#13788a'],
    ['#9884fa', '#5a43c8'],
    ['#efaa5f', '#c4612d'],
    ['#ea7896', '#a8396a'],
    ['#62bf74', '#2a7b47']
];

let instances = 0;

export default {
    name: 'ProfileAvatar',
    props: {
        name: {
            type: String,
            default: ''
        },
        size: {
            type: Number,
            default: 40
        }
    },
    data() {
        instances += 1;
        return {
            gradientId: `avatar-gradient-${instances}`
        };
    },
    computed: {
        palette() {
            let hash = 0;
            for (const char of this.name) {
                hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
            }
            return PALETTES[hash % PALETTES.length];
        }
    }
};
</script>

<style scoped>
.avatar {
    display: block;
    border-radius: 50%;
}
</style>
