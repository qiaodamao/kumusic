/**
 * Meting API - EdgeOne Pages Edge Functions 版
 * 基于 xizeyoupan/Meting-API 移植，仅支持网易云（netease）音源
 *
 * 文件路径 edge-functions/api/index.js → 路由 /api
 * 访问示例：https://music.shijuefuhao.com/api?server=netease&type=playlist&id=21158650
 */

// ==================== 辅助函数 ====================

function base64Encode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function strToBytes(str) {
  return new TextEncoder().encode(str);
}

// base64url 字符串转 BigInt
function base64urlToBigInt(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const bytes = base64Decode(base64);
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

// ==================== 加密模块 ====================

const AES_IV = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10]);
const PRESET_KEY = strToBytes('0CoJUm6Qyw8W8jud');
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const NETEASE_PUBLIC_KEY_B64 = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB';
const NETEASE_ANONYMOUS_TOKEN = 'de91e1f8119d32e01cc73efcb82c0a30c9137e8d4f88dbf5e3d7bf3f28998f21add2bc8204eeee5e56c0bbb8743574b46ca2c10c35dc172199bef9bf4d60ecdeab066bb4dc737d1c3324751bcc9aaf44c3061cd18d77b7a0';

let rsaKeyCache = null;

// 从 PEM 公钥提取 modulus 和 exponent（使用 Web Crypto API）
async function getRsaKey() {
  if (rsaKeyCache) return rsaKeyCache;
  const derBytes = base64Decode(NETEASE_PUBLIC_KEY_B64);
  const key = await crypto.subtle.importKey(
    'spki', derBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    true, ['verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  rsaKeyCache = {
    n: base64urlToBigInt(jwk.n),
    e: base64urlToBigInt(jwk.e),
  };
  return rsaKeyCache;
}

// AES-128-CBC 加密（Web Crypto API）
async function aesCbcEncrypt(data, key, iv) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'AES-CBC' }, false, ['encrypt']
  );
  return await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv }, cryptoKey, data);
}

// RSA NO PADDING 加密（BigInt 实现）
function rsaNoPadding(buffer, n, e) {
  // 前面补 0 到 128 字节（1024 位 RSA）
  const padded = new Uint8Array(128);
  padded.set(buffer, 128 - buffer.length);
  // 转为 BigInt
  let m = 0n;
  for (let i = 0; i < padded.length; i++) {
    m = (m << 8n) | BigInt(padded[i]);
  }
  // 模幂运算 m^e mod n
  let result = 1n;
  let base = m % n;
  let exp = e;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % n;
    base = (base * base) % n;
    exp >>= 1n;
  }
  // 转回字节数组
  const hex = result.toString(16).padStart(256, '0');
  const bytes = new Uint8Array(128);
  for (let i = 0; i < 128; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// weapi 加密
async function weapiEncrypt(object) {
  const text = JSON.stringify(object);
  const textBytes = strToBytes(text);

  // 生成随机 secretKey
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const secretKey = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    secretKey[i] = BASE62.charCodeAt(randomBytes[i] % 62);
  }

  // 第一次 AES-CBC: text -> presetKey
  const encrypted1 = await aesCbcEncrypt(textBytes, PRESET_KEY, AES_IV);
  const encrypted1Base64 = base64Encode(encrypted1);
  const encrypted1Bytes = strToBytes(encrypted1Base64);

  // 第二次 AES-CBC: encrypted1Base64 -> secretKey
  const encrypted2 = await aesCbcEncrypt(encrypted1Bytes, secretKey, AES_IV);
  const params = base64Encode(encrypted2);

  // RSA: secretKey 反转后加密
  const reversedKey = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    reversedKey[i] = secretKey[15 - i];
  }
  const { n, e } = await getRsaKey();
  const encSecKey = hexEncode(rsaNoPadding(reversedKey, n, e));

  return { params, encSecKey };
}

// ==================== 网易云 API ====================

// 国内 IP 段（用于伪装请求来源）
const CN_IPS = '58.14.0.0,118.88.88.88,221.234.0.0,180.76.0.0,123.125.0.0,121.42.0.0,222.73.0.0,120.78.0.0,112.74.0.0,139.196.0.0'.split(',');

function randomCnIp() {
  return CN_IPS[Math.floor(Math.random() * CN_IPS.length)];
}

function nanoid() {
  const chars = '1234567890abcdef';
  let id = '';
  const random = crypto.getRandomValues(new Uint8Array(32));
  for (let i = 0; i < 32; i++) {
    id += chars[random[i] % chars.length];
  }
  return id;
}

// 发送网易云请求
async function neteaseRequest(url, data, cryptoMode) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': 'https://music.163.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.30 Safari/537.36',
    'X-Real-IP': randomCnIp(),
    'X-Forwarded-For': randomCnIp(),
  };

  // Cookie 设置（匿名访问）
  const cookie = {
    __remember_me: true,
    _ntes_nuid: nanoid(),
    MUSIC_A: NETEASE_ANONYMOUS_TOKEN,
  };
  headers['Cookie'] = Object.keys(cookie)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(cookie[k]))
    .join('; ');

  let bodyData = data;
  let reqUrl = url;

  if (cryptoMode === 'weapi') {
    data.csrf_token = '';
    bodyData = await weapiEncrypt(data);
    reqUrl = url.replace(/\w*api/, 'weapi');
  }
  // 'api' 模式：不加密，直接发送

  const body = new URLSearchParams(bodyData).toString();
  let res, count = 0;
  do {
    res = await fetch(reqUrl, { method: 'POST', headers, body });
    res = await res.json();
    count++;
    if (count > 5) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (res.code === -460);

  return res;
}

// 映射歌曲列表
function mapSongList(songList) {
  return songList.songs.map(song => {
    const artists = song.ar || song.artists || [];
    return {
      title: song.name,
      author: artists.reduce((acc, v) => (acc ? acc + ' / ' : '') + v.name, ''),
      pic: (song.al && song.al.picUrl) || song.id,
      url: song.id,
      lrc: song.id,
    };
  });
}

// 获取歌单
async function getPlaylist(id) {
  // 第一步：获取歌单 trackIds（不加密）
  let res = await neteaseRequest(
    'https://music.163.com/api/v6/playlist/detail',
    { id, n: 100000, s: 8 },
    'api'
  );

  const trackIds = res.playlist.trackIds;
  const limit = 200;
  const offset = 0;

  // 第二步：获取歌曲详情（weapi 加密）
  const idsData = {
    c: '[' + trackIds.slice(offset, offset + limit)
      .map(item => '{"id":' + item.id + '}')
      .join(',') + ']',
  };

  res = await neteaseRequest(
    'https://music.163.com/api/v3/song/detail',
    idsData,
    'weapi'
  );

  return mapSongList(res);
}

// 获取单曲信息
async function getSongInfo(id) {
  const data = {
    c: '[{"id":' + id + '}]',
  };
  const res = await neteaseRequest(
    'https://music.163.com/api/v3/song/detail',
    data,
    'weapi'
  );
  if (!res.songs) throw res;
  return mapSongList(res);
}

// 获取播放 URL（直接使用网易云公开外链）
async function getSongUrl(id) {
  return 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3';
}

// 获取歌词
async function getLyric(id) {
  const res = await neteaseRequest(
    'https://music.163.com/api/song/lyric?_nmclfl=1',
    { id, tv: -1, lv: -1, rv: -1, kv: -1 },
    'api'
  );
  return {
    lyric: (res.lrc && res.lrc.lyric) || '',
    tlyric: (res.tlyric && res.tlyric.lyric) || '',
  };
}

// ==================== 歌词格式化 ====================

function formatLyric(lyric, tlyric) {
  const lyricArray = trimLyric(lyric);
  const tlyricArray = trimLyric(tlyric);
  if (tlyricArray.length === 0) return lyric;

  const result = [];
  for (let i = 0, j = 0; i < lyricArray.length && j < tlyricArray.length; i++) {
    const time = lyricArray[i].time;
    let text = lyricArray[i].text;
    while (time > tlyricArray[j].time && j + 1 < tlyricArray.length) j++;
    if (time === tlyricArray[j].time && tlyricArray[j].text.length) {
      text = text + ' (' + tlyricArray[j].text + ')';
    }
    result.push({ time, text });
  }

  return result.map(x => {
    const mm = Math.floor(x.time / 60000).toString().padStart(2, '0');
    const ss = Math.floor((x.time % 60000) / 1000).toString().padStart(2, '0');
    const ms = Math.floor(x.time % 1000).toString().padStart(3, '0');
    return '[' + mm + ':' + ss + '.' + ms + ']' + x.text;
  }).join('\n');
}

function trimLyric(lyric) {
  const result = [];
  const lines = lyric.split('\n');
  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2})[.:](\d+)\](.*)$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
      result.push({
        time: minutes * 60000 + seconds * 1000 + milliseconds,
        text: match[4],
      });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

// ==================== 响应辅助 ====================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function redirectResponse(url) {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': url,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ==================== 主处理函数（EdgeOne Pages Edge Functions 入口） ====================

export default async function onRequest({ request }) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const server = params.get('server') || 'netease';
  const type = params.get('type') || 'playlist';
  const id = params.get('id');

  // 仅支持网易云
  if (server !== 'netease') {
    return jsonResponse({ error: '仅支持 netease（网易云）音源' }, 400);
  }

  if (!id) {
    return jsonResponse({ error: '缺少 id 参数' }, 400);
  }

  try {
    let data;
    switch (type) {
      case 'playlist': {
        data = await getPlaylist(id);
        const baseUrl = url.origin + url.pathname;
        data = data.map(x => {
          for (const key of ['url', 'pic', 'lrc']) {
            const val = String(x[key]);
            if (!val.startsWith('@') && !val.startsWith('http') && val.length > 0) {
              x[key] = baseUrl + '?server=netease&type=' + key + '&id=' + val;
            }
          }
          return x;
        });
        return jsonResponse(data);
      }
      case 'song': {
        data = await getSongInfo(id);
        const baseUrl2 = url.origin + url.pathname;
        data = data.map(x => {
          for (const key of ['url', 'pic', 'lrc']) {
            const val = String(x[key]);
            if (!val.startsWith('@') && !val.startsWith('http') && val.length > 0) {
              x[key] = baseUrl2 + '?server=netease&type=' + key + '&id=' + val;
            }
          }
          return x;
        });
        return jsonResponse(data);
      }
      case 'url':
        data = await getSongUrl(id);
        return redirectResponse(data);

      case 'pic': {
        const songInfo = await getSongInfo(id);
        data = songInfo[0].pic;
        if (data && data.startsWith('http')) return redirectResponse(data);
        return textResponse('no pic', 404);
      }
      case 'lrc': {
        const lyricData = await getLyric(id);
        return textResponse(formatLyric(lyricData.lyric, lyricData.tlyric || ''));
      }
      default:
        return jsonResponse({ error: '不支持的 type: ' + type }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
}
