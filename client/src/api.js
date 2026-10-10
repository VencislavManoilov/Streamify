import axios from 'axios';
import { API_URL } from './config';
import { session } from './session';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
    const token = session.token;
    if (token && !config.headers.Authorization) {
        config.headers.Authorization = token;
    }
    return config;
});

// A rejected token anywhere means the session is over: go to the login page instead of showing errors
api.interceptors.response.use(
    response => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            session.expire();
        }
        return Promise.reject(error);
    }
);

export default api;
