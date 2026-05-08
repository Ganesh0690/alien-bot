const { Telegraf } = require('telegraf');
const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const callsDB = [];
const leaderboardDB = {};

const evmRegex = /0x[a-fA-F0-9]{40}/i;
const solRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const tonRegex = /EQ[a-zA-Z0-9_-]{46}/i;

const deleteMarkup = {
  reply_markup: {
    inline_keyboard: [[{ text: '🗑️', callback_data: 'delete_msg' }]]
  }
};

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

bot.action('delete_msg', async (ctx) => {
  try {
    await ctx.deleteMessage();
  } catch (error) {
  }
});

bot.command('calls', async (ctx) => {
  if (callsDB.length === 0) return ctx.reply('No recent calls.', deleteMarkup);

  let text = `📞 <b>Last 15 Calls</b>\n\n`;
  let callsLines = [];

  for (const call of callsDB) {
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
  ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...deleteMarkup });
});

bot.command('lb', async (ctx) => {
  const sorted = Object.entries(leaderboardDB).sort((a, b) => b[1].points - a[1].points);
  
  let text = `🏆 <b>Leaderboard</b>\n\n👑 <b>Top Callers</b>\n`;
  if (sorted.length > 0) {
    text += `└ 🥇 ${escapeHTML(sorted[0][0])} [${sorted[0][1].points.toFixed(1)} pts]\n`;
  } else {
    text += `└ No callers yet.\n`;
  }

  text += `\n📊 <b>Group Stats</b>\n├ Period 1d\n├ Calls ${callsDB.length}\n├ Hit Rate 0%\n├ Median 0%\n└ Return 1.0x (Avg: 1.0x)\n\n`;

  let listLines = [];
  for (let i = 0; i < Math.min(callsDB.length, 6); i++) {
    const call = callsDB[i];
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
  ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...deleteMarkup });
});

bot.command('p', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return;
  const query = parts[1].toLowerCase();

  try {
    const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
    if (!dexResponse.data.pairs || dexResponse.data.pairs.length === 0) {
      return ctx.reply('Token not found.', deleteMarkup);
    }

    const pair = dexResponse.data.pairs[0];
    const name = escapeHTML(pair.baseToken.name);
    const symbol = escapeHTML(pair.baseToken.symbol);
    const priceUsd = pair.priceUsd;
    const mc = formatNumber(pair.fdv);
    const vol24 = formatNumber(pair.volume.h24);
    const priceChange = pair.priceChange?.h24 || 0;
    const sign = priceChange >= 0 ? '+' : '';

    const text = `<a href="${pair.url}">${name}</a> ($${symbol})\n\nPrice: <b>$${priceUsd}</b> (${sign}${priceChange}%)\nLow: N/A\nHigh: N/A\nMC/FDV: <b>$${mc} / $${mc}</b>\nRank: N/A\nATH: N/A\n\nVolume: $${vol24}`;

    ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...deleteMarkup });
  } catch (error) {
  }
});

bot.command('fc', (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return;
  const address = parts[1];
  const call = callsDB.find(c => c.address === address);
  if (call) {
    ctx.reply(`First caller for ${address} is @${call.caller} at ${call.mcapFormatted}`, deleteMarkup);
  }
});

bot.command('c', (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return;
  ctx.reply(`Chart link: https://dexscreener.com/search?q=${parts[1]}`, deleteMarkup);
});

bot.command('pnl', async (ctx) => {
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
    await ctx.replyWithPhoto({ source: buffer }, { ...deleteMarkup });
  } catch (error) {
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const msgMatch = text.match(evmRegex) || text.match(solRegex) || text.match(tonRegex);

  if (msgMatch) {
    const address = msgMatch[0];
    const caller = ctx.from.username || ctx.from.first_name;

    try {
      const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      const pairs = dexResponse.data.pairs;

      if (!pairs || pairs.length === 0) return;

      const pair = pairs[0];
      const chainId = pair.chainId;
      const symbol = escapeHTML(pair.baseToken.symbol);
      const name = escapeHTML(pair.baseToken.name);
      const priceUsd = Number(pair.priceUsd);
      const mcRaw = pair.fdv || 0;
      const mc = formatNumber(mcRaw);
      const vol = formatNumber(pair.volume.h24);
      const lp = formatNumber(pair.liquidity.usd);
      const dsUrl = pair.url;
      const gmgnUrl = `https://gmgn.ai/${chainId}/token/${address}`;
      const bannerUrl = pair.info?.header || pair.info?.imageUrl;
      
      const priceChange24h = pair.priceChange?.h24 || 0;
      const sign24h = priceChange24h >= 0 ? '+' : '';
      const priceChange1h = pair.priceChange?.h1 || 0;
      const sign1h = priceChange1h >= 0 ? '+' : '';
      
      const buys1h = pair.txns?.h1?.buys || 0;
      const sells1h = pair.txns?.h1?.sells || 0;

      const icon = getChainIcon(chainId, dsUrl, pair.labels);
      
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

      if (chainId === 'ethereum') {
        try {
          const goPlusResponse = await axios.get(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${address}`);
          const securityData = goPlusResponse.data.result[address.toLowerCase()];

          if (securityData) {
            taxBuy = securityData.buy_tax === "" ? "0%" : `${(Number(securityData.buy_tax) * 100).toFixed(1)}%`;
            taxSell = securityData.sell_tax === "" ? "0%" : `${(Number(securityData.sell_tax) * 100).toFixed(1)}%`;
            lpLocked = securityData.is_in_dex === "1" ? "Check LP" : "Unknown";
          }
        } catch (error) {
        }
      }

      const isFirstCall = !callsDB.find(c => c.address === address);

      if (isFirstCall) {
        callsDB.unshift({ 
          address, 
          caller, 
          time: Date.now(), 
          mcapFormatted: mc, 
          priceRaw: priceUsd,
          athPrice: priceUsd,
          symbol,
          name,
          icon
        });
        if (callsDB.length > 15) callsDB.pop();

        if (!leaderboardDB[caller]) leaderboardDB[caller] = { points: 0, hits: 0 };
        leaderboardDB[caller].points += 1;
      }

      const originalCall = callsDB.find(c => c.address === address);
      const callerName = originalCall ? originalCall.caller : caller;
      const calledMcap = originalCall ? originalCall.mcapFormatted : mc;
      const ageStr = originalCall ? getTimeElapsed(originalCall.time) : '0m';

      let responseText = `${icon} ${name} ($${symbol})
├ <code>${address}</code>
└ #${chainId.toUpperCase()} | ${ageStr} | 👀 41

📊 Stats
├ USD  <b>$${priceUsd}</b> (${sign24h}${priceChange24h}%)
├ MC   <b>$${mc}</b>
├ Vol  $${vol}
├ LP   $${lp}
├ 1H   ${sign1h}${priceChange1h}% 🟢 ${buys1h} 🔴 ${sells1h}
└ ATH  N/A

🔗 Socials
└ ${xLink}${webLink}`;

      if (chainId === 'ethereum' || chainId === 'base') {
          responseText += `\n\n🔒 Security
├ Tax     Buy: ${taxBuy} | Sell: ${taxSell}
└ LP Lock ${lpLocked}`;
      }

      responseText += `\n\n<a href="${dsUrl}">DS</a> • <a href="${gmgnUrl}">GMGN</a>\n\n😈 @${callerName} @ $${calledMcap}`;

      if (bannerUrl) {
        await ctx.replyWithPhoto({ url: bannerUrl }, { caption: responseText, parse_mode: 'HTML', ...deleteMarkup });
      } else {
        await ctx.reply(responseText, { parse_mode: 'HTML', disable_web_page_preview: true, ...deleteMarkup });
      }

    } catch (error) {
    }
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));