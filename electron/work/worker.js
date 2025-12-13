const _ = require('lodash');
const { parentPort, workerData } = require('worker_threads');
const puppeteer = require('puppeteer');
const { sleep, formatYear } = require('../utils/index.js');
const { randomName } = require('../utils/names.js');
const Config = require('../db/config');
const Device = require('../db/device');
const Material = require('../db/material');
const History = require('../db/history');
const AdsPower = require('../utils/ads_power.js');

let status = true;

const init = () => {
    parentPort.on('message', (message) => {
        const { type } = message;
        if (type === "stop") {
            status = false;
        }
    });
}

const task = async (page, device) => {
    while (status && !page.isClosed()) {
        try {
            let material = await Material.pop();
            if (!material) {
                break;
            }
            const amount = device.amount;
            const account = device.account;
            const card = material.card;
            const month = material.month;
            const year = formatYear(material.year);
            const cvv = material.cvv;
            const name = randomName();
            if (_.isNil(card) || _.isNil(month) || _.isNil(year) || _.isNil(cvv)) {
                await updateMaterial(material.id, { status: 3, note: '卡号、月、年、cvv不能为空' });
                continue;
            }
            await updateMaterial(material.id, { device: "设备: " + device.symbol });
            while (status && !page.isClosed()) {
                try {
                    // 1.打开网站
                    // await page.bringToFront();
                    await page.goto("https://qr.telkom.co.za", { waitUntil: "domcontentloaded" });
                    // 2.选择Top Up
                    await page.locator('h2 ::-p-text("Top Up")').click();
                    // 3.选择Airtime
                    await page.locator('h2 ::-p-text("Airtime")').click();
                    // 4.填写手机号
                    await page.locator('input[type="text"][placeholder="Enter mobile number"]').fill(account);
                    // 5.点击Next
                    await page.locator('button.cursor-pointer ::-p-text("Next")').click();
                    // 6.选中Own Amount
                    await page.locator('div ::-p-text("Own amount")').click();
                    // 7.填写金额
                    await page.locator('input[type="text"][placeholder="Enter airtime amount"]').fill(String(amount));
                    await sleep(2000);
                    // 8.点击Next
                    await page.locator('button.cursor-pointer ::-p-text("Next")').click();
                    // 9.确认金额
                    await Promise.any([
                        await page.locator('h1 ::-p-text("Your Summary")').wait(),
                        await page.locator('label ::-p-text("Visa & Credit")').wait()
                    ]);
                    // 9.1.再次点击Next
                    await page.locator('button.monice-btn-active ::-p-text("Next")').click();
                    // 10.填写卡号
                    await page.locator('input#ccNumber[name="ccNumber"]').setTimeout(60000).fill(card);
                    // 11.填写持卡人姓名
                    await page.locator('input#ccName[name="ccName"]').fill(name);
                    // 12.选择有效期: 月
                    await page.locator('select#ccOpMonth[name="ccOpMonth"]').fill(month);
                    // 13.选择有效期: 年
                    await page.locator('select#ccOpYear[name="ccOpYear"]').fill(year);
                    // 14.填写cvv
                    await page.locator('input#ccCvv[name="ccCvv"]').fill(cvv);
                    // 探针
                    if (!status) return;
                    await sleep(2000);
                    // 15.点击Next
                    await page.locator('button#nextBtn[name="payhostPay"]').click();
                    // 16.等待结果，最多等2分钟
                    await page.locator('button ::-p-text("Home Page")').setTimeout(120000).wait();
                    // 17.获得结果
                    const result = await page.locator('p ::-p-text("Payment")').map(p => p.innerText).wait() || '';
                    if (result.includes('Payment Completed')) {
                        // 成功
                        material = await updateMaterial(material.id, { status: 2, amount: material.amount + amount, note: result }, true);
                        await saveHistory({ ...material });
                        continue;
                    } else if (result.includes('Payment declined')) {
                        // 失败
                        if (material.status != 2) {
                            await updateMaterial(material.id, { status: 3, note: result });
                            await saveHistory({ ...material });
                        }
                        break;
                    } else {
                        // 未知
                        await updateMaterial(material.id, { status: 3, note: result });
                        await saveHistory({ ...material });
                        break;
                    }
                } catch (error) {
                    if (error.name == "TimeoutError") {
                        // 超时
                        console.error(error);
                        continue;
                    }
                    throw error;
                }
            }
            // 记录工作次数
            device = await updateDevice(device.id, { count: device.count + 1 }, true);
        } catch (error) {
            console.error(error);
        }
    }
}

const execute = async (device, config) => {
    const symbol = device.symbol;
    const adsPower = new AdsPower(config.adsPowerUrl, config.adsPowerApiKey);
    const ws = await adsPower.start(symbol);
    const browser = await puppeteer.connect({
        browserWSEndpoint: ws
    });
    // 启动成功
    parentPort.postMessage({
        type: 'started',
        data: 'started'
    });
    const count = parseInt(config.pageCount) || 1;
    const pages = await browser.pages();
    // 关闭多余页面
    await Promise.all(pages.slice(1, pages.length).map(async (p) => await p.close()));
    pages.splice(1, pages.length);
    // 补充页面
    for (let i = 1; i < count; i++) {
        const p = await browser.newPage();
        pages.push(p);
    }
    const width = parseInt(config.viewportWidth) || 1280;
    const height = parseInt(config.viewportHeight) || 800;
    // 设置视口
    await Promise.all(pages.map(async (p) => await p.setViewport({ width, height })));
    // 核心任务
    await Promise.all(pages.map(async (p) => await task(p, device)));
    // 关闭浏览器
    await browser.close();
    console.log(`[${symbol}] Browser closed`);
}

(async function () {
    // 初始化
    init();

    // 校验浏览器配置
    const config = await Config.config();
    if (_.isNil(config.adsPowerUrl)) {
        throw new Error('指纹浏览器URL不能为空');
    }
    if (_.isNil(config.adsPowerApiKey)) {
        throw new Error('指纹浏览器APIKEY不能为空');
    }

    // 校验设备配置
    const deviceId = workerData.deviceId;
    const device = await Device.get(deviceId);
    if (!device) {
        throw new Error('设备不存在: ' + deviceId);
    }
    if (_.isNil(device.symbol)) {
        throw new Error('设备标识为空: ' + deviceId);
    }
    if (_.isNil(device.amount)) {
        throw new Error('金额不能为空: ' + deviceId);
    }
    if (_.isNil(device.account)) {
        throw new Error('账户不能为空: ' + deviceId);
    }
    if (device.amount <= 0) {
        throw new Error('金额不能小于等于0: ' + deviceId);
    }
    try {
        await execute(device, config);
        // 结束
        parentPort.postMessage({
            type: 'stopped',
            data: 'stopped'
        });
    } catch (error) {
        throw error;
    }
})();

const updateMaterial = async (materialId, data = {}, reload = false) => {
    await Material.update(materialId, data);
    parentPort.postMessage({ type: 'material:reload' });
    if (reload) {
        return await Material.get(materialId);
    }
}

const updateDevice = async (deviceId, data = {}, reload = false) => {
    await Device.update(deviceId, data);
    parentPort.postMessage({ type: 'device:reload' });
    if (reload) {
        return await Device.get(deviceId);
    }
}

const saveHistory = async (data) => {
    const history = await History.getByCard(data.card);
    if(history) {
        await History.delete(history.id);
    }
    await History.create({ ...data });
}