<template>
    <div class="admin-panel">
        <h1>Admin Panel</h1>
        <div class="users">
            <h2>Users</h2>
            <button class="invite" @click="showModal = true">+ Invite</button>
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
                    <td>{{ new Date(user.created_at).toLocaleString() }}</td>
                </tr>
                <tr v-if="!users.length">
                    <td colspan="5">No users found</td>
                </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="modal" v-if="showModal" @click.self="showModal = false">
        <div class="modal-content">
            <button class="closeButton" v-on:click="showModal = false">
                <svg class="closeSvg" viewBox="0 0 122.878 122.88" enable-background="new 0 0 122.878 122.88"><g><path d="M1.426,8.313c-1.901-1.901-1.901-4.984,0-6.886c1.901-1.902,4.984-1.902,6.886,0l53.127,53.127l53.127-53.127 c1.901-1.902,4.984-1.902,6.887,0c1.901,1.901,1.901,4.985,0,6.886L68.324,61.439l53.128,53.128c1.901,1.901,1.901,4.984,0,6.886 c-1.902,1.902-4.985,1.902-6.887,0L61.438,68.326L8.312,121.453c-1.901,1.902-4.984,1.902-6.886,0 c-1.901-1.901-1.901-4.984,0-6.886l53.127-53.128L1.426,8.313L1.426,8.313z"/></g></svg>
            </button>
            <h2>Invite User</h2>
            <p class="inviteInfo">Send an invitation to a new user.</p>
            <input type="email" v-model="inviteEmail" placeholder="Email" />
            <p v-if="inviteError" style="color: red;">{{ inviteError }}</p>
            <p v-if="inviteSuccess" style="color: green;">{{ inviteSuccess }}</p>
            <button class="inviteButton" @click="inviteUser">Send Invite</button>
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
            users: [],
            showModal: false,
            inviteEmail: '',
            inviteError: '',
            inviteSuccess: ''
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
        },
        async inviteUser() {
            try {
                const response = await axios.post(URL+'/admin/invite', {
                    email: this.inviteEmail
                }, {
                    headers: {
                        Authorization: localStorage.getItem('token')
                    }
                });
                this.inviteSuccess = response.data.message;
                this.inviteError = '';
            } catch (error) {
                this.inviteError = error.response.data.message || error.response.data || 'An error occurred';
                this.inviteSuccess = '';
                console.error('Error inviting user:', error);
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

.invite {
    background-color: #4CAF50;
    color: white;
    padding: 10px 20px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 16px;
    transition: background-color 0.3s ease;
    margin-bottom: 12px;
}

.invite:hover {
    background-color: #45a049;
}

.closeButton {
    position: absolute;
    width: 48px;
    height: 48px;
    margin: 0px;
    border-radius: 24px;
    border: none;
    background-color: rgba(0, 0, 0, 0.363);
    align-content: center;
    cursor: pointer;
}

.closeSvg {
    width: 20px;
    height: 20px;
    margin: auto;
    align-self: center;
    margin-top: 3px;
    fill: rgb(238, 238, 238);
}

.modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
}

.modal-content {
    background-color: #222;
    padding: 20px;
    border-radius: 12px;
    position: relative;
    width: 400px;
}

.modal h2 {
    text-align: center;
    margin-top: 12px;
}

.modal input {
    width: calc(100% - 24px);
    padding: 12px;
    margin: 12px 0;
    border-radius: 6px;
    border: 1px solid #333;
}

.inviteInfo {
    margin-top: 48px;
    margin-bottom: 0;
}

.inviteButton {
    width: 100%;
    padding: 12px;
    margin: 12px 0;
    border-radius: 6px;
    border: none;
    background-color: #333;
    color: white;
    cursor: pointer;
}
</style>