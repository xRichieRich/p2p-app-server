# 🌐 P2P Photo Vault – Vlastní Relay & Web Admin Server

Tento server slouží jako spolehlivý internetový most pro aplikaci **P2P Photo Vault**. Umožňuje bezpečné propojení telefonů kdekoli na světě (na Wi-Fi i mobilních datech 4G/5G) a poskytuje vám **Webový administrátorský panel** (`/admin`), kde máte celou komunikaci, živý log i schvalování požadavků pod přímou kontrolou.

---

## ⚡ Hlavní výhody
- **Žádné limity velikosti**: Podpora až 50 MB zašifrovaných fotografií a videí.
- **Webový Admin Panel na `/admin`**: Chráněno vaším heslem `Admin124`.
- **End-to-End šifrování**: Veškerá data jsou na telefonech šifrována pomocí AES-256-GCM. Server vidí pouze nečitelné šifrované bloky.
- **100% Bezplatný hosting bez kreditní karty**: Lze provozovat na moderních bezplatných službách (Render.com, Hugging Face Spaces) nebo na vlastním počítači.

---

## 🚀 1. Možnost A: Hugging Face Spaces (Doporučeno – 100% ZDARMA, běží 24/7, bez karty)

Hugging Face Spaces nabízí bezplatný Docker/Node.js hosting s 16 GB RAM bez nutnosti zadávat jakékoli platební údaje. Soubory lze vytvořit přímo v prohlížeči:

1. Zaregistrujte se / přihlaste na **[huggingface.co](https://huggingface.co)** (zdarma, bez karty).
2. Klikněte nahoře na profilovou fotku ➔ **New Space**.
3. Nastavení:
   - **Space name**: např. `muj-trezor-server`
   - **Space SDK**: Vyberte **Docker**
   - **Docker template**: **Blank**
   - **Visibility**: **Public** (veřejný je 100% zdarma)
4. Klikněte na **Create Space**.
5. V nově vytvořeném Space klikněte na záložku **Files** ➔ **Add file** ➔ **Create a new file**:
   - Vytvořte soubor `package.json` a vložte obsah ze souboru `server/package.json`. Klikněte dole na **Commit new file**.
   - Vytvořte soubor `server.js` a vložte obsah ze souboru `server/server.js`. Klikněte na **Commit new file**.
   - Vytvořte soubor `Dockerfile` a vložte obsah ze souboru `server/Dockerfile`. Klikněte na **Commit new file**.
6. Hugging Face začne automaticky sestavovat kontejner (trvá cca 1 minutu).
7. Jakmile naskočí zelený stav **Running**:
   - Vaše adresa je: `https://<VASE_UZIVATELSKE_JMENO>-muj-trezor-server.hf.space`
   - Tuto adresu zadejte do mobilní aplikace v **Nastavení serveru** (nebo otevřete `/admin` v prohlížeči).

---

## 🚀 2. Možnost B: Render.com (100% ZDARMA, bez kreditní karty)

Render je spolehlivá cloudová platforma s bezplatným tierem pro Node.js webové služby:

1. Zaregistrujte se zdarma na **[render.com](https://render.com)** (stačí přihlášení přes GitHub nebo Google).
2. Nahrajte složku `server` do svého GitHub repozitáře (nebo repozitáře projektu).
3. Na Render nástěnce klikněte na **New +** ➔ **Web Service**.
4. Propojte svůj GitHub repozitář.
5. Nastavení:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
6. Klikněte na **Deploy Web Service**.
7. Po dokončení máte k dispozici trvalou HTTPS adresu: `https://<nazev>.onrender.com`.

---

## 💻 3. Možnost C: Spuštění na vlastním PC / Macu (pro BlueStacks i mobily)

Pokud máte počítač zapnutý a chcete server provozovat přímo u sebe:

1. V terminálu přejděte do složky `server`:
   ```bash
   cd server
   npm install
   node server.js
   ```
2. Server se spustí na portu `3000`:
   - **Pro BlueStacks na stejném PC**: V aplikaci zadejte URL `http://10.0.2.2:3000`
   - **Pro mobily na stejné Wi-Fi**: Zjistěte IP adresu vašeho PC (např. `192.168.1.50`) a zadejte `http://192.168.1.50:3000`
   - **Web Admin Panel na PC**: Otevřete v prohlížeči `http://localhost:3000/admin`

3. **Chcete veřejnou HTTPS adresu z PC na celý internet bez port forwardingu?**
   Spusťte v druhém terminálu:
   ```bash
   npx localtunnel --port 3000
   ```
   Získáte okamžitou veřejnou HTTPS adresu (např. `https://cool-panda-42.loca.lt`), kterou zadáte do telefonů.

---

## 🛡️ Webový Admin Panel (`/admin`)

Otevřením adresy vašeho serveru s koncovkou `/admin` (např. `https://vase-domena/admin`):
- **Heslo pro vstup**: `Admin124`
- **Živý audit log**: Okamžitě vidíte všechny události (žádosti o přístup, schválení, nahrání fotek).
- **Vzdálené schválení žádosti**: Přímo v prohlížeči můžete jedním kliknutím schválit žádost uživatele.
- **Promazání historie**: Tlačítko pro vyčištění serverové paměti.
