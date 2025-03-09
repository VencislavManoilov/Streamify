<template>
    <div class="admin-panel">
        <h1>Admin Panel</h1>
        <div class="users">
            <h2>Users</h2>
            <table v-if="users.length">
                <thead>
                <tr>
                    <th>ID</th>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created At</th>
                </tr>
                </thead>
                <tbody>
                <tr v-for="user in users" :key="user.id">
                    <td>{{ user.id }}</td>
                    <td>{{ user.username }}</td>
                    <td>{{ user.email }}</td>
                    <td>{{ user.role }}</td>
                    <td>{{ user.created_at }}</td>
                </tr>
                <tr v-if="!users.length">
                    <td colspan="5">No users found</td>
                </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'AdminPanel',
    data() {
        return {
            users: []
        };
    },
    async mounted() {
        const token = localStorage.getItem('token');
        if (!token) {
            this.$router.push('/admin/auth');
        } else {
            try {
                const response = await axios.get(URL + '/admin/me', {
                    headers: {
                        Authorization: token
                    }
                });

                if(!response.data.user) {
                    this.$router.push('/admin/auth');
                }
            } catch (error) {
                this.$router.push('/admin/auth');
            }
        }
        this.fetchUsers();
    },
    methods: {
        async fetchUsers() {
            try {
                const response = await axios.get(URL+'/admin/users', {
                    headers: {
                        Authorization: localStorage.getItem('token')
                    }
                });
                this.users = response.data;
            } catch (error) {
                console.error('Error fetching users:', error);
            }
        }
    }
};
</script>

<style scoped>
.admin-panel {
    padding: 20px;
}

.admin-panel h1 {
    margin-bottom: 20px;
}

.admin-panel ul {
    list-style-type: none;
    padding: 0;
}

.admin-panel li {
    margin: 5px 0;
}

.admin-panel table {
    width: 100%;
    margin-bottom: 20px;
    border-spacing: 0;
    border-radius: 12px;
    border-collapse: separate;
    overflow: hidden;
    border: 1px solid #ddd;
}

.admin-panel th, .admin-panel td {
    padding: 12px;
    text-align: left;
    border: 1px solid #ddd;
}

.admin-panel th {
    background-color: #222;
    font-weight: bold;
}

.admin-panel tr:nth-child(even) {
    background-color: #111111;
}

.admin-panel tr:hover {
    background-color: #111111;
}
</style>