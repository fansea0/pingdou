import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeProvince, normalizeCity, resolveRegion, __resetGeoForTest } from '../../../server/geo.js';

describe('geo 归一化', () => {
  beforeEach(() => __resetGeoForTest());
  afterEach(() => __resetGeoForTest());

  it('裸省份名补后缀，直辖市补「市」', () => {
    expect(normalizeProvince('广东')).toBe('广东省');
    expect(normalizeProvince('江苏')).toBe('江苏省');
    expect(normalizeProvince('上海')).toBe('上海市');
    expect(normalizeProvince('北京')).toBe('北京市');
  });

  it('自治区 / 特别行政区原样保留，补后缀反而是错的', () => {
    expect(normalizeProvince('内蒙古')).toBe('内蒙古');
    expect(normalizeProvince('广西')).toBe('广西');
    expect(normalizeProvince('香港')).toBe('香港');
    expect(normalizeProvince('台湾')).toBe('台湾');
  });

  it('已有后缀的不重复补', () => {
    expect(normalizeProvince('广东省')).toBe('广东省');
    expect(normalizeProvince('新疆维吾尔自治区')).toBe('新疆维吾尔自治区');
  });

  it('内网 / 空值 / 「中国」一律判为查不到', () => {
    expect(normalizeProvince('内网IP')).toBeNull();
    expect(normalizeProvince('')).toBeNull();
    expect(normalizeProvince('0')).toBeNull();
    expect(normalizeProvince('中国')).toBeNull();
    expect(normalizeProvince(null)).toBeNull();
    expect(normalizeProvince(undefined)).toBeNull();
    expect(normalizeCity('内网IP')).toBeNull();
  });

  it('剥离控制字符并截断超长脏数据', () => {
    expect(normalizeCity('深圳\u0000市')).toBe('深圳市');
    const dirty = normalizeProvince('广' + '东'.repeat(100) + '!!!');
    expect(dirty).not.toBeNull();
    // clean 截断到 32，再补一个「省」后缀
    expect(dirty!.length).toBeLessThanOrEqual(33);
    expect(dirty!.endsWith('省')).toBe(true);
  });

  it('province 字段返回「中国」 = 库只知道国别，归为未知', () => {
    expect(normalizeProvince('中国')).toBeNull();
  });
});

describe('resolveRegion 离线库通道', () => {
  beforeEach(() => __resetGeoForTest());
  afterEach(() => __resetGeoForTest());

  it('公网 IP 解析出省 + 市', () => {
    const r = resolveRegion('120.24.78.68');
    expect(r.province).toBe('广东省');
    expect(r.city).toBe('深圳市');
    expect(r.source).toBe('db');
  });

  it('境外 IP 归到「境外」，不伪装成省份', () => {
    const r = resolveRegion('8.8.8.8');
    expect(r.province).toBe('境外');
  });

  it('内网 / 非法 IP 不查库，直接未知', () => {
    expect(resolveRegion('127.0.0.1').province).toBeNull();
    expect(resolveRegion('192.168.1.20').province).toBeNull();
    expect(resolveRegion('10.0.0.5').province).toBeNull();
    expect(resolveRegion('172.16.3.4').province).toBeNull();
    expect(resolveRegion('unknown').province).toBeNull();
  });

  it('同一 IP 重复查询走缓存，结果稳定', () => {
    const a = resolveRegion('114.114.114.114');
    const b = resolveRegion('114.114.114.114');
    expect(b).toEqual(a);
  });
});

describe('resolveRegion 反代 header 通道', () => {
  beforeEach(() => __resetGeoForTest());
  afterEach(() => {
    __resetGeoForTest();
    delete process.env.PINGDOU_TRUST_GEO_HEADER;
  });

  it('默认不信任 header，防止伪造灌脏数据', () => {
    const r = resolveRegion('8.8.8.8', { 'x-geo-province': 'Hacked' });
    expect(r.source).toBe('db');
  });

  it('显式开启后 header 优先于离线库', () => {
    process.env.PINGDOU_TRUST_GEO_HEADER = '1';
    const r = resolveRegion('8.8.8.8', { 'x-geo-province': '广东', 'x-geo-city': '深圳' });
    expect(r).toEqual({ province: '广东省', city: '深圳', source: 'header' });
  });

  it('header 缺失 / 为空时回落离线库', () => {
    process.env.PINGDOU_TRUST_GEO_HEADER = '1';
    const r = resolveRegion('114.114.114.114', { 'x-geo-province': '' });
    expect(r.source).toBe('db');
    expect(r.province).toBe('江苏省');
  });

  it('string[] 形态的 header 也能吃下', () => {
    process.env.PINGDOU_TRUST_GEO_HEADER = '1';
    const r = resolveRegion('114.114.114.114', { 'x-geo-province': ['浙江'] });
    expect(r.province).toBe('浙江省');
  });
});
