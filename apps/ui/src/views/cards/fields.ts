import type { Card } from '@browser-2d/contracts/public';

export type CardDraft = Omit<
  Card,
  'id' | 'amount' | 'status' | 'inputLocked' | 'lastResult' | 'createdAt' | 'updatedAt'
>;
export const cardFields = [
  { key: 'number', label: '卡号', width: 220 },
  { key: 'expiryMonth', label: '到期月', width: 100 },
  { key: 'expiryYear', label: '到期年', width: 100 },
  { key: 'securityCode', label: '安全码', width: 100 },
  { key: 'cardholderName', label: '持卡人', width: 150 },
  { key: 'billingAddress', label: '地址', width: 240 },
  { key: 'billingCity', label: '城市', width: 140 },
  { key: 'billingRegion', label: '州 / 省', width: 140 },
  { key: 'billingPostalCode', label: '邮编', width: 120 },
  { key: 'billingCountryCode', label: '国家代码', width: 110 },
  { key: 'extra', label: '扩展文本', width: 220 },
  { key: 'notes', label: '备注', width: 220 },
] satisfies { key: keyof CardDraft; label: string; width: number }[];
export const cardStatusLabels: Record<Card['status'], string> = {
  pending: '待处理',
  processing: '处理中',
  processed: '已处理',
  failed: '失败',
};
export function resultText(result: Card['lastResult']) {
  if (!result) return '尚无验证结果';
  return `验证${result.outcome === 'success' ? '成功' : '失败'} · ${result.message} · ${result.processor} · ${result.committedAt}${result.data ? ` · ${JSON.stringify(result.data)}` : ''}`;
}
export function cardDraft(row: Card): CardDraft {
  return {
    number: row.number,
    expiryMonth: row.expiryMonth,
    expiryYear: row.expiryYear,
    securityCode: row.securityCode,
    cardholderName: row.cardholderName,
    billingAddress: row.billingAddress,
    billingCity: row.billingCity,
    billingRegion: row.billingRegion,
    billingPostalCode: row.billingPostalCode,
    billingCountryCode: row.billingCountryCode,
    extra: row.extra,
    notes: row.notes,
  };
}
