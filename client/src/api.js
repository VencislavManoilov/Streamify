import axios from 'axios';
import { API_URL } from './config';
import { connection } from './connection';
import { session } from './session';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
    const token = session.token;
    if (token && !config.headers.Authorization) {
        config.headers.Authorization = token;
    }
    return config;
});

// A rejected token anywhere means the session is over: go to the login page instead of showing errors.
// A request that got no answer at all may mean the connection is gone, which shows a popup.
api.interceptors.response.use(
    response => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            session.expire();
        } else if (!error.response && !axios.isCancel(error)) {
            connection.check();
        }
        return Promise.reject(error);
    }
);

export default api;
