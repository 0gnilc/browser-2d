function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatYear(value) {
    const str = String(value);
    if (!str || str.trim().length < 2) {
        return null;
    }
    if (!/^\d+$/.test(str)) {
        return null;
    }
    return `20${str.slice(-2)}`;
}

export { sleep, formatYear };