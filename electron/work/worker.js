const _ = require('lodash');
const { parentPort, workerData } = require('worker_threads');
const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { sleep } = require('../utils/index.js');
const { randomName } = require('../utils/names.js');
const Config = require('../db/config');
const Device = require('../db/device');
const Material = require('../db/material');
const History = require('../db/history');
const AdsPower = require('../utils/ads_power.js');

let status = true;
let screenshotBasePath;

const init = () => {
    // 截图保存路径
    screenshotBasePath = path.join(os.homedir(), 'kys', 'screenshots');
    if (!fs.existsSync(screenshotBasePath)) {
        fs.mkdirSync(screenshotBasePath, { recursive: true });
    }
    parentPort.on('message', (message) => {
        const { type } = message;
        if (type === "stop") {
            status = false;
        }
    });
}

const wait = async (page, timeout = 30000, ...selectors) => {
    let used = 0;
    const single = 100;
    while (true) {
        for (let i = 0; i < selectors.length; i++) {
            const selector = selectors[i];
            try {
                await page.locator(selector).setTimeout(single).wait();
                return {
                    index: i,
                    selector
                };
            } catch (error) {
                if (error.name != "TimeoutError") {
                    throw error;
                }
            }
            used += single;
            if (used > timeout) {
                throw new Error('TimeoutError');
            }
        }
    }
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
            const day = material.day;
            const cvv = material.cvv;
            const name = randomName();
            if (_.isNil(card) || _.isNil(month) || _.isNil(day) || _.isNil(cvv)) {
                await updateMaterial(material.id, { status: 3, note: '卡号、月、日、cvv不能为空' });
                continue;
            }
            await updateMaterial(material.id, { device: "设备: " + device.symbol });
            while (status && !page.isClosed()) {
                try {
                    // 1.打开网站
                    await page.goto("http://m.tataxingqiu.com/txqfe/recharge_wx/down.html", { waitUntil: "domcontentloaded" });
                    await sleep();
                    // 2.星币充值
                    await page.locator('div ::-p-text("星币充值")').click();
                    await sleep();
                    await page.locator('div ::-p-text("他ta星球星币充值")').wait();
                    // 3.填写账户
                    const accountResult = await wait(page, 30000, 'div ::-p-text("更换账户")', 'input[type="text"][placeholder="请输入需要充值的用户ID"]');
                    await sleep();
                    if (accountResult.index == 0) {
                        await page.locator(accountResult.selector).click();
                        await sleep();
                    }
                    await page.locator('input[type="text"][placeholder="请输入需要充值的用户ID"]').fill(account);
                    await sleep();
                    await page.locator('div.btn:not(.disable) ::-p-text("搜索")').click();
                    await sleep();
                    // 4.选择金额
                    await page.locator(`div.product-item > div ::-p-text("${amount}")`).click();
                    await sleep();
                    // 5.选择支付方式
                    await page.locator('div.pay-method > div ::-p-text("VISA")').click();
                    await sleep();
                    // 6.确认充值
                    await page.locator('div.confirm ::-p-text("确认充值")').click();
                    await sleep();
                    // 7.填写卡号
                    await page.locator('input#cardNo-element[name="cardNo"]').setTimeout(60000).fill(card);
                    await sleep();
                    // 8.填写有效期
                    await page.locator('input#expiryDate-element[name="expiryDate"]').fill(`${month}${day}`);
                    await sleep();
                    // 9.填写cvv
                    await page.locator('input#cardCVV-element[name="cardCVV"]').fill(cvv);
                    await sleep();
                    // 10.填写持卡人姓名
                    await page.locator('input#cardHolderName-element').fill(name);
                    await sleep();
                    // 11.确认支付
                    await page.locator('div ::-p-text("支付 ")').click();
                    await sleep();
                    // 探针
                    if (!status) return;
                    // 12.处理结果
                    const paymentResult = await wait(page, 120000,
                        'h1 ::-p-text("Transaction Verification")', // 3D
                        'p ::-p-text("Your purchase requires additional verification")', // 3D
                        '::-p-text("支付失败")',
                        '::-p-text("由于安全原因，支付被拒绝")', // 风控
                        '::-p-text("支付成功")');
                    if ([0, 1].includes(paymentResult.index)) {
                        // 3D验证
                        await updateMaterial(material.id, { status: 4, note: "3D验证" }, true);
                        await saveHistory({ ...material });
                        break;
                    } else if (paymentResult.index == 2) {
                        // 支付失败
                        await updateMaterial(material.id, { status: 3, note: "支付失败" }, true);
                        await saveHistory({ ...material });
                        // 保存结果
                        break;
                    } else if (paymentResult.index == 3) {
                        // 风控
                        await updateMaterial(material.id, { status: 3, note: "风控" }, true);
                        await saveHistory({ ...material });
                        break;
                    }
                    else if (paymentResult.index == 4) {
                        // 支付成功
                        // 截图
                        await page.screenshot({
                            path: path.join(screenshotBasePath, `${material.card}-${Date.now()}.png`),
                        });
                        material = await updateMaterial(material.id, { status: 2, amount: material.amount + amount }, true);
                        await saveHistory({ ...material });
                        continue;
                    }
                } catch (error) {
                    if (error.name == "TimeoutError" || error.message == "TimeoutError") {
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
    // await Promise.all(pages.map(async (p) => await task(p, device)));
    // 测试
    await Promise.all(pages.map(async (p) => await test(p)));
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
    if (history) {
        await History.delete(history.id);
    }
    await History.create({ ...data });
}

const test = async (page) => {
    const element = await page.waitForSelector('iframe');
    const iframe = await element.contentFrame();
    const text = await iframe.locator('h1 ::-p-text("Transaction Verification")').map(p => p.innerText()).wait();
    console.log(iframe);
    console.log(text);
}