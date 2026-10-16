// Small formatters shared by the admin panel tabs

export function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '–';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes);
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond || 0)}/s`;
}

// 3725 -> "1h 2m"
export function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total / 3600) % 24;
    const minutes = Math.floor(total / 60) % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m`;
    return `${total}s`;
}

export function formatHours(seconds) {
    const hours = (Number(seconds) || 0) / 3600;
    return hours >= 10 ? Math.round(hours).toLocaleString() : hours.toFixed(1);
}

export function timeAgo(date) {
    if (!date) return 'never';
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 0) return 'just now';
    if (diff < 45) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60) || 1}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
    return formatDate(date);
}

export function formatDate(date) {
    if (!date) return '–';
    return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(date) {
    if (!date) return '–';
    return new Date(date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function errorText(error, fallback = 'Something went wrong') {
    const data = error && error.response && error.response.data;
    if (data && typeof data === 'object') return data.message || data.error || fallback;
    if (typeof data === 'string' && data) return data;
    return error && !error.response ? 'The server could not be reached' : fallback;
}
