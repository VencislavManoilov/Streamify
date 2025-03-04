<template>
    <div class="welcome-container">
        <h1>Welcome to Streamify</h1>
        <div class="button-group">
            <router-link :to="'/login'">
                <button>Login</button>
            </router-link>
            <router-link :to="'/register'">
                <button>Register</button>
            </router-link>
        </div>
    </div>
</template>

<script>
export default {
    name: 'WelcomePage'
}
</script>

<style scoped>
.welcome-container {
    text-align: center;
    margin-top: 50px;
}

.button-group {
    margin-top: 20px;
}

button {
    margin: 0 10px;
    padding: 10px 20px;
    font-size: 16px;
    cursor: pointer;
}
</style>