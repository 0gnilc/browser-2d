const REGEX = /----|----|--|\|\||\||\/|-/g;

const convert = (text) => {
    if (!text || typeof text !== 'string') {
        return [];
    }
    const lines = text.split("\n").filter(Boolean);
    return lines.map(line => {
        const parts = line.split(REGEX).filter(Boolean);
        if (parts.length < 4) {
            return null;
        }
        const card = parts[0].trim();
        const month = parts[1].trim();
        const day = parts[2].trim();
        const cvv = parts[3].trim();
        const extra = parts.length > 4 ? parts.slice(4).join("|") : "";

        // card: 纯数字，不能小于10位
        if (card && (!/^\d+$/.test(card) || card.length < 10)) {
            return null;
        }
        // month: 纯数字，大于1小于12
        if (month && (!/^\d+$/.test(month) || parseInt(month, 10) < 1 || parseInt(month, 10) > 12)) {
            return null;
        }
        // day: 纯数字
        if (day && !/^\d+$/.test(day) || parseInt(day, 10) < 1 || parseInt(day, 10) > 31) {
            return null;
        }
        // cvv: 纯数字，不能小于3位
        if (cvv && (!/^\d+$/.test(cvv) || cvv.length < 3)) {
            return null;
        }

        return {
            card,
            month,
            day,
            cvv,
            extra,
        }
    }).filter(item => item !== null);
}

export { convert };