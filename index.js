const { Telegraf } = require('telegraf');
const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');
const http = require('http');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const groupCalls = {};
const groupLeaderboard = {};

const evmRegex = /0x[a-fA-F0-9]{40}/i;
const solRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const tonRegex = /EQ[a-zA-Z0-9_-]{46}/i;
const cashtagRegex = /(?:^|\s)\$([a-zA-Z0-9]{2,10})(?=\s|$)/;

const formatNumber = (num) => {
  if (!num) return '0';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return Number(num).toFixed(4);
};

const getTimeElapsed = (timestamp) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const getChainIcon = (chainId, url, labels) => {
  if (url && url.includes('pump.fun') || (labels && labels.includes('pump'))) return '💊';
  if (url && url.includes('bags')) return '🎒';
  if (chainId === 'ethereum') return '🔷';
  if (chainId === 'solana') return '🟣';
  if (chainId === 'base') return '🔵';
  return '💎';
};

const escapeHTML = (str) => {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

async function getTokenMessage(address, callerInfo, chatId) {
  try {
    const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const pairs = dexResponse.data.pairs;
    
    if (!pairs || pairs.length === 0) return null;

    const pair = pairs[0];
    const chainId = pair.chainId;
    const symbol = escapeHTML(pair.baseToken.symbol);
    const name = escapeHTML(pair.baseToken.name);
    const priceUsd = pair.priceUsd;
    const mc = formatNumber(pair.fdv);
    const vol = formatNumber(pair.volume.h24);
    const lp = formatNumber(pair.liquidity.usd);
    
    const priceChange24h = pair.priceChange?.h24 || 0;
    const sign24h = priceChange24h >= 0 ? '+' : '';
    const priceChange1h = pair.priceChange?.h1 || 0;
    const sign1h = priceChange1h >= 0 ? '+' : '';
    
    const buys1h = pair.txns?.h1?.buys || 0;
    const sells1h = pair.txns?.h1?.sells || 0;
    const icon = getChainIcon(chainId, pair.url, pair.labels);

    let xLink = '';
    let webLink = '';
    if (pair.info && pair.info.socials) {
        const xSocial = pair.info.socials.find(s => s.type === 'twitter');
        if (xSocial) xLink = `<a href="${xSocial.url}">X [@]</a> • `;
    }
    if (pair.info && pair.info.websites && pair.info.websites.length > 0) {
        webLink = `<a href="${pair.info.websites[0].url}">Web</a>`;
    }

    let taxBuy = 'N/A';
    let taxSell = 'N/A';
    let lpLocked = 'Unknown';

    if (chainId === 'ethereum' || chainId === 'base') {
      try {
        const goPlusId = chainId === 'ethereum' ? '1' : '8453';
        const secRes = await axios.get(`https://api.gopluslabs.io/api/v1/token_security/${goPlusId}?contract_addresses=${address}`);
        const data = secRes.data.result[address.toLowerCase()];
        if (data) {
          taxBuy = data.buy_tax === "" ? "0%" : `${(Number(data.buy_tax) * 100).toFixed(1)}%`;
          taxSell = data.sell_tax === "" ? "0%" : `${(Number(data.sell_tax) * 100).toFixed(1)}%`;
          lpLocked = data.lp_holders && data.lp_holders.some(h => h.is_locked === 1) ? "Yes" : "No";
        }
      } catch (e) {}
    }

    if (!groupCalls[chatId]) groupCalls[chatId] = [];
    let call = groupCalls[chatId].find(c => c.address.toLowerCase() === address.toLowerCase());
    
    if (!call && callerInfo) {
      call = { 
        address, 
        caller: callerInfo, 
        time: Date.now(), 
        mcapFormatted: mc, 
        priceRaw: Number(priceUsd), 
        symbol, 
        icon, 
        athPrice: Number(priceUsd) 
      };
      groupCalls[chatId].unshift(call);
      if (groupCalls[chatId].length > 15) groupCalls[chatId].pop();
      
      if (!groupLeaderboard[chatId]) groupLeaderboard[chatId] = {};
      groupLeaderboard[chatId][callerInfo] = (groupLeaderboard[chatId][callerInfo] || 0) + 1;
    }

    const age = call ? getTimeElapsed(call.time) : '0m';
    const firstCaller = call ? call.caller : (callerInfo || 'Unknown');
    const firstMcap = call ? call.mcapFormatted : mc;

    let text = `${icon} ${name} ($${symbol})
├ <code>${address}</code>
└ #${chainId.toUpperCase()} | ${age} | 👀 41

📊 <b>Stats</b>
├ <b>USD</b>  <b>$${priceUsd}</b> (${sign24h}${priceChange24h}%)
├ <b>MC</b>   <b>$${mc}</b>
├ <b>Vol</b>  <b>$${vol}</b>
├ <b>LP</b>   <b>$${lp}</b>
├ <b>1H</b>   <b>${sign1h}${priceChange1h}%</b> 🟢 <b>${buys1h}</b> 🔴 <b>${sells1h}</b>
└ <b>ATH</b>  <b>N/A</b>

🔗 <b>Socials</b>
└ ${xLink}${webLink}`;

    if (chainId === 'ethereum' || chainId === 'base') {
      text += `\n\n🔒 <b>Security</b>
├ <b>Tax</b>     <b>Buy: ${taxBuy} | Sell: ${taxSell}</b>
└ <b>LP Lock</b> <b>${lpLocked}</b>`;
    }

    text += `\n\n<a href="${pair.url}">DS</a> • <a href="https://gmgn.ai/${chainId}/token/${address}">GMGN</a>\n\n😈 @${firstCaller} @ $${firstMcap}`;

    return { text, banner: pair.info?.header || pair.info?.imageUrl };
  } catch (e) {
    return null;
  }
}

bot.action('delete_msg', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {}
});

bot.action(/refresh:(.+)/, async (ctx) => {
  const address = ctx.match[1];
  const data = await getTokenMessage(address, null, ctx.chat.id);
  
  if (data) {
    const markup = { 
      inline_keyboard: [
        [{ text: '🔄 Refresh', callback_data: `refresh:${address}` }, { text: '🗑️', callback_data: 'delete_msg' }]
      ] 
    };
    try {
      if (ctx.callbackQuery.message.photo) {
        await ctx.editMessageCaption(data.text, { parse_mode: 'HTML', reply_markup: markup });
      } else {
        await ctx.editMessageText(data.text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
      }
    } catch (e) {}
  }
  await ctx.answerCbQuery('Stats Refreshed!');
});

bot.command('calls', async (ctx) => {
  const chatId = ctx.chat.id;
  const calls = groupCalls[chatId] || [];
  
  const markup = { inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]] };

  if (calls.length === 0) return ctx.reply('No recent calls in this group.', markup);

  let text = `📞 <b>Last 15 Calls</b>\n\n`;
  let callsLines = [];

  for (const call of calls) {
    try {
      const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${call.address}`);
      const pair = dexResponse.data.pairs ? dexResponse.data.pairs[0] : null;
      
      let currentPercent = 0;
      let athMult = 1.0;
      
      if (pair && call.priceRaw > 0) {
        const currentPrice = Number(pair.priceUsd);
        currentPercent = ((currentPrice - call.priceRaw) / call.priceRaw) * 100;
        
        if (currentPrice > call.athPrice) {
            call.athPrice = currentPrice;
        }
        athMult = call.athPrice / call.priceRaw;
      }

      const formattedPercent = currentPercent > 0 ? `${currentPercent.toFixed(0)}%` : `${currentPercent.toFixed(0)}%`;
      const timeStr = getTimeElapsed(call.time);
      
      callsLines.push(`${call.icon} <a href="https://dexscreener.com/search?q=${call.address}">${escapeHTML(call.symbol)}</a> @ ${call.mcapFormatted} (${timeStr}) 👀\n└ Current: ${formattedPercent} | ATH: ${athMult.toFixed(1)}x`);
    } catch (e) {
      callsLines.push(`${call.icon} ${escapeHTML(call.symbol)} @ ${call.mcapFormatted} (${getTimeElapsed(call.time)})\n└ Current: N/A | ATH: N/A`);
    }
  }

  text += callsLines.join('\n\n');
  ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...markup });
});

bot.command('lb', async (ctx) => {
  const chatId = ctx.chat.id;
  const lbData = groupLeaderboard[chatId] || {};
  const calls = groupCalls[chatId] || [];
  const markup = { inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]] };

  const sorted = Object.entries(lbData).sort((a, b) => b[1] - a[1]);
  
  let text = `🏆 <b>Leaderboard</b>\n\n👑 <b>Top Callers</b>\n`;
  if (sorted.length > 0) {
    text += `└ 🥇 ${escapeHTML(sorted[0][0])} [${sorted[0][1].toFixed(1)} pts]\n`;
  } else {
    text += `└ No callers yet.\n`;
  }

  text += `\n📊 <b>Group Stats</b>\n├ Period 1d\n├ Calls ${calls.length}\n├ Hit Rate 0%\n├ Median 0%\n└ Return 1.0x (Avg: 1.0x)\n\n`;

  let listLines = [];
  for (let i = 0; i < Math.min(calls.length, 6); i++) {
    const call = calls[i];
    let multiplier = "1.0x";
    let perfEmoji = "😎";
    
    try {
      const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${call.address}`);
      const pair = dexResponse.data.pairs ? dexResponse.data.pairs[0] : null;
      if (pair && call.priceRaw > 0) {
        const currentPrice = Number(pair.priceUsd);
        const multVal = currentPrice / call.priceRaw;
        multiplier = `${multVal.toFixed(1)}x`;
        if (multVal >= 5) perfEmoji = "🎉";
        else if (multVal < 1) perfEmoji = "😭";
      }
    } catch(e) {}

    listLines.push(`${perfEmoji} ${call.icon} <b>${i+1}</b> <a href="https://dexscreener.com/search?q=${call.address}">${escapeHTML(call.symbol)}</a> » <i>${escapeHTML(call.caller)}</i> 👀\n[${multiplier}]`);
  }

  text += listLines.join('\n\n');
  ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...markup });
});

bot.command('p', async (ctx) => {
  const markup = { inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]] };
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return;
  const query = parts[1].toLowerCase();

  try {
    const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
    if (!dexResponse.data.pairs || dexResponse.data.pairs.length === 0) {
      return ctx.reply('Token not found.', markup);
    }

    const pair = dexResponse.data.pairs[0];
    const name = escapeHTML(pair.baseToken.name);
    const symbol = escapeHTML(pair.baseToken.symbol);
    const priceUsd = pair.priceUsd;
    const mc = formatNumber(pair.fdv);
    const vol24 = formatNumber(pair.volume.h24);
    const priceChange = pair.priceChange?.h24 || 0;
    const sign = priceChange >= 0 ? '+' : '';

    const text = `<a href="${pair.url}">${name}</a> ($${symbol})\n\nPrice: <b>$${priceUsd}</b> (${sign}${priceChange}%)\nLow: N/A\nHigh: N/A\nMC/FDV: <b>$${mc} / $${mc}</b>\nRank: N/A\nATH: N/A\n\nVolume: <b>$${vol24}</b>`;

    ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...markup });
  } catch (error) {}
});

bot.command('fc', (ctx) => {
  const markup = { inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]] };
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return;
  const address = parts[1];
  const calls = groupCalls[ctx.chat.id] || [];
  const call = calls.find(c => c.address.toLowerCase() === address.toLowerCase());
  
  if (call) {
    ctx.reply(`First caller for ${address} is @${call.caller} at ${call.mcapFormatted}`, markup);
  } else {
    ctx.reply('Token not found in group history.', markup);
  }
});

bot.command('c', (ctx) => {
  const markup = { inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]] };
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return;
  ctx.reply(`Chart link: https://dexscreener.com/search?q=${parts[1]}`, markup);
});

bot.command('pnl', async (ctx) => {
  const markup = { inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]] };
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return;

  const symbol = parts[1].toUpperCase();
  const percent = parts[2];
  const isProfit = !percent.startsWith('-');
  const color = isProfit ? '#00FF00' : '#FF0000';

  try {
    const canvas = createCanvas(600, 300);
    const c = canvas.getContext('2d');

    c.fillStyle = '#121212';
    c.fillRect(0, 0, 600, 300);

    c.fillStyle = '#1e1e1e';
    c.fillRect(20, 20, 560, 260);

    let avatarUrl = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id);
    
    if (photos.total_count > 0) {
      const fileId = photos.photos[0][0].file_id;
      const file = await ctx.telegram.getFile(fileId);
      avatarUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    }

    const avatar = await loadImage(avatarUrl);
    c.save();
    c.beginPath();
    c.arc(90, 150, 50, 0, Math.PI * 2, true);
    c.closePath();
    c.clip();
    c.drawImage(avatar, 40, 100, 100, 100);
    c.restore();

    c.fillStyle = '#FFFFFF';
    c.font = 'bold 30px Arial';
    c.fillText(ctx.from.username || ctx.from.first_name, 160, 120);

    c.fillStyle = '#AAAAAA';
    c.font = '24px Arial';
    c.fillText(`Token: ${symbol}`, 160, 160);

    c.fillStyle = color;
    c.font = 'bold 48px Arial';
    c.fillText(`${isProfit ? '+' : ''}${percent}%`, 160, 220);

    const buffer = canvas.toBuffer('image/png');
    await ctx.replyWithPhoto({ source: buffer }, { ...markup });
  } catch (error) {}
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const msgMatch = text.match(evmRegex) || text.match(solRegex) || text.match(tonRegex);
  const tickerMatch = text.match(cashtagRegex);

  let address = msgMatch ? msgMatch[0] : null;

  if (!address && tickerMatch) {
    try {
      const search = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${tickerMatch[1]}`);
      if (search.data.pairs && search.data.pairs.length > 0) {
        address = search.data.pairs[0].baseToken.address;
      }
    } catch (e) {}
  }

  if (address) {
    const caller = ctx.from.username || ctx.from.first_name;
    const data = await getTokenMessage(address, caller, ctx.chat.id);

    if (data) {
      const markup = { 
        inline_keyboard: [
          [{ text: '🔄 Refresh', callback_data: `refresh:${address}` }, { text: '🗑️', callback_data: 'delete_msg' }]
        ] 
      };

      if (data.banner) {
        await ctx.replyWithPhoto({ url: data.banner }, { caption: data.text, parse_mode: 'HTML', reply_markup: markup });
      } else {
        await ctx.reply(data.text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
      }
    }
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Alien Bot is running!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});