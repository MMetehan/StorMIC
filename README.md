# StorMIC — Desktop Voice & Chat App

> **[English](#english) | [Türkçe](#türkçe)**
>
> ![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

---

<a name="english"></a>

## English

### What is StorMIC?

StorMIC is a minimal, privacy-first peer-to-peer voice and chat desktop application built with Electron. There is no central server that relays or stores your messages, audio, or files — everything flows directly between participants over WebRTC. The only server involved is a lightweight signaling relay used exclusively to help peers discover each other and exchange connection metadata.

No accounts. No message history stored anywhere. When the last person leaves a channel, it ceases to exist.

> **You need to run your own signaling server.** See [`StorMIC-Backend/README.md`](https://github.com/MMetehan/StorMIC-Backend/blob/main/README.md) for setup instructions.

---

### Features

#### Voice

- **Push-to-Talk (PTT)** — hold a configurable key or mouse button to transmit
- **Open Mic** — toggle-style always-on microphone mode
- **Speaking indicator** — real-time voice activity detection via Web Audio API; participant names light up when they speak
- **Per-user volume control** — click any participant to open a volume popover and adjust or mute them independently
- **Noise suppression, echo cancellation, auto gain control** — individually toggleable in settings
- **Custom input/output device selection** — pick your mic and speakers from the settings panel
- **Keyboard & mouse shortcut rebinding** — assign any key or side mouse button to PTT and Mic Toggle

#### Video & Screen Share

- **Camera sharing** — share your webcam with all channel members
- **Screen sharing** — configurable resolution (720p / 1080p) and frame rate (30 / 60 fps)
- **Spotlight + strip layout** — the active stream fills a large spotlight area; all other streams appear in a scrollable thumbnail strip below
- **Click to spotlight** — click any thumbnail in the strip to bring it to the spotlight
- **Fullscreen** — expand the spotlight to fullscreen with a single click
- **Mirror mode** — flip your local camera preview horizontally

#### Chat & Files

- **Text chat** — real-time messages over WebRTC data channels; no server involved
- **Emoji picker** — built-in emoji panel with 36 emojis, inserts at cursor position
- **File transfer** — drag-and-drop or attach button; files are sent as chunked binary data (16 KB chunks) directly over WebRTC data channels
- **File progress bar** — live progress indicator while receiving files
- **Image preview** — received image files are displayed inline in the chat

#### Connection & UX

- **Connection quality indicator** — color-coded RTT dot (green < 80 ms / yellow < 200 ms / red ≥ 200 ms) on each participant
- **Auto-reconnect** — exponential backoff reconnection (1.5 s × 2ⁿ, capped at 30 s) on unexpected disconnects
- **Join/leave sound effects** — subtle audio cues when participants enter or leave
- **Per-user profile colors** — each username gets a consistent color derived from a hash of the name
- **Last-used username memory** — your username is remembered across sessions
- **Custom signaling server** — point the app at your own signaling server from the channel screen or in-room settings panel
- **Frameless window** — custom titlebar with minimize, maximize, and close controls

---

### Signaling Server

StorMIC requires a signaling server to work. The server is a tiny stateless WebSocket relay — no accounts, no storage, no message history. See **[`StorMIC-Backend/README.md`](https://github.com/MMetehan/StorMIC-Backend/blob/main/README.md)** for:

- How to run the server locally
- How to deploy to Render.com or Heroku
- The full WebSocket message protocol

Once your server is running, configure the URL in `.env` before building (see below), or set it at runtime from the app's Settings panel → Signaling Server URL.

---

### Architecture

```
Electron Client
├── Main Process      src/main.js              — Window lifecycle, IPC, screen capture
├── Preload           src/preload.js           — Context bridge: window controls + signal URL
└── Renderer          src/renderer/
    ├── index.html    — Screen markup (username → channel → room)
    ├── signal-url.js — Auto-generated at build time from .env (gitignored)
    ├── styles.css    — Dark theme, layout, components
    └── app.js        — All business logic (~1500 lines, vanilla JS)
```

#### How it works

1. **Signaling** — On joining a channel, the client opens a WebSocket to the signaling server and sends a `join` message with the channel code, username, and intent (`create` or `join`). The server responds with a list of current peers. The client then creates a `RTCPeerConnection` for each peer and begins the offer/answer handshake via the server as a relay.

2. **WebRTC** — Once ICE negotiation completes, all subsequent communication (audio, video, chat, files) flows directly peer-to-peer. The signaling server is no longer involved.

3. **Data channels** — Chat messages, file metadata, file chunks, speaking state, and video track announcements all travel over a single ordered WebRTC data channel per peer pair. Binary chunks are distinguished from JSON control messages by type checking.

4. **Video tile management** — When a user enables their camera or screen share, they broadcast a `video-track` message (containing the WebRTC track ID and kind) over the data channel to all peers. The receiving side waits for both the track (via `pc.ontrack`) and the message; whichever arrives first is buffered until the other arrives, then the tile is rendered.

5. **Glare resolution** — When two peers simultaneously initiate offers (WebRTC glare), the peer with `initiator: true` wins and the incoming offer is discarded.

---

### Tech Stack

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| Desktop shell  | Electron 31                               |
| WebRTC         | Native browser APIs (`RTCPeerConnection`) |
| Audio analysis | Web Audio API (`AnalyserNode`)            |
| Media capture  | `getUserMedia`, `getDisplayMedia`         |
| UI             | Vanilla JS, HTML5, CSS3 — no frameworks   |
| Persistence    | `localStorage` only                       |
| Build          | electron-builder 24                       |

---

### Signaling Server URL — `.env` Setup

The signaling server URL is **never stored in the repository**. It is baked into the app at build time from a local `.env` file.

```bash
# 1. Copy the example file
cp .env.example .env

# 2. Edit .env and fill in your server URL
#    Example: STORMIC_SIGNAL_URL=wss://your-server.example.com
```

The `.env` file and the generated `src/renderer/signal-url.js` are both gitignored. The URL will never appear in version control.

**Priority order at runtime:**

1. `localStorage` — URL set manually by the user in the app's Settings panel (overrides everything)
2. `signal-url.js` — URL baked in from `.env` at build time
3. `process.env.STORMIC_SIGNAL_URL` — system environment variable (for advanced deployments)
4. Empty — user must configure the URL in the app's Settings panel

---

### Installation & Development

**Prerequisites:** Node.js ≥ 18, npm

```bash
# 1. Set up your .env (see above)
cp .env.example .env
# edit .env

# 2. Install dependencies and start the app
make install
make dev

# 3. In a separate terminal, start the local signaling server
make server
```

`make dev` automatically runs `scripts/generate-env.js` before launching Electron, so `signal-url.js` is always generated from your `.env`.

If `.env` is missing or `STORMIC_SIGNAL_URL` is not set, the app starts with no default URL — configure it from the Settings panel (⚙) or the channel screen's "Sunucu Ayarı" toggle.

---

### Building for Distribution

```bash
# Set up .env first (required — build will warn if URL is missing)
cp .env.example .env
# edit .env with your production server URL

make mac      # macOS — produces a .dmg (x64 + arm64 universal)
make win      # Windows — produces an NSIS .exe installer (x64)
make linux    # Linux — produces an .AppImage (x64)
make all      # All three platforms
make clean    # Remove the dist/ folder
```

Output goes to `client/dist/`.

Each build command runs `scripts/generate-env.js` first, which reads `STORMIC_SIGNAL_URL` from `.env` and writes it into `src/renderer/signal-url.js`. electron-builder then packages that file into the binary. The URL is baked in and invisible in the repo.

> **Note:** macOS builds must be run on macOS; Windows and Linux builds can be cross-compiled from macOS with the appropriate electron-builder toolchain.

---

### Project Structure

```
client/
├── .env.example              — Template for required environment variables
├── .env                      — Your local config (gitignored, never committed)
├── assets/
│   ├── icon.icns             — macOS app icon
│   ├── icon.ico              — Windows app icon
│   └── icon.png              — Linux app icon
├── scripts/
│   └── generate-env.js       — Reads .env, writes src/renderer/signal-url.js
├── src/
│   ├── main.js               — Electron main process
│   ├── preload.js            — Context bridge
│   └── renderer/
│       ├── index.html        — App UI
│       ├── signal-url.js     — Auto-generated (gitignored)
│       ├── styles.css        — Styles
│       └── app.js            — Business logic
└── package.json              — Electron + electron-builder config
```

---

### Settings & Persistence

All user preferences are stored in `localStorage`:

| Key                         | Default     | Description                    |
| --------------------------- | ----------- | ------------------------------ |
| `stormic_username`          | —           | Last used username             |
| `stormic_ptt`               | Space       | PTT key binding                |
| `stormic_mic_toggle`        | —           | Mic toggle key binding         |
| `stormic_signal_url`        | from `.env` | Signaling server URL override  |
| `stormic_input_device`      | Default     | Microphone device ID           |
| `stormic_output_device`     | Default     | Speaker device ID              |
| `stormic_noise_suppression` | `true`      | Noise suppression toggle       |
| `stormic_echo_cancellation` | `true`      | Echo cancellation toggle       |
| `stormic_agc`               | `false`     | Auto gain control toggle       |
| `stormic_speak_threshold`   | `8`         | Speaking detection sensitivity |

---

### License

[MIT](LICENSE) © 2026 StorMIC

---

<br>
<br>

---

<a name="türkçe"></a>

## Türkçe

### StorMIC Nedir?

StorMIC, Electron ile geliştirilmiş minimal ve gizlilik odaklı bir eşten-eşe (P2P) sesli iletişim ve sohbet masaüstü uygulamasıdır. Mesajlarınız, sesiniz veya dosyalarınız herhangi bir merkezi sunucudan geçmez — her şey WebRTC aracılığıyla katılımcılar arasında doğrudan akar. Sunucu yalnızca kullanıcıların birbirini bulmasını ve bağlantı meta verilerini paylaşmasını sağlamak için kullanılır.

Hesap yok. Hiçbir yerde mesaj geçmişi tutulmaz. Kanaldan son kişi ayrıldığında kanal silinir.

> **Kendi sinyal sunucunu çalıştırman gerekir.** Kurulum talimatları için [`StorMIC-Backend/README.md`](https://github.com/MMetehan/StorMIC-Backend/blob/main/README.md) dosyasına bak.

---

### Özellikler

#### Ses

- **Bas-Konuş (PTT)** — iletim için yapılandırılabilir tuş veya fare düğmesine basılı tut
- **Açık Mikrofon** — her zaman açık olan toggle mikrofon modu
- **Konuşma göstergesi** — Web Audio API ile gerçek zamanlı ses aktivitesi tespiti; konuşan kullanıcının adı vurgulanır
- **Kullanıcı başına ses seviyesi kontrolü** — herhangi bir katılımcıya tıklayarak o kullanıcının sesini ayrı ayrı ayarla veya kapat
- **Gürültü engelleme, yankı azaltma, otomatik kazanım kontrolü** — ayarlar panelinden tek tek açılıp kapatılabilir
- **Özel giriş/çıkış aygıtı seçimi** — ayarlar panelinden mikrofon ve hoparlörünü seç
- **Klavye ve fare kısayolu yeniden atama** — PTT ve Mikrofon Aç/Kapat için istediğin tuşu veya fare yan düğmesini ata

#### Video ve Ekran Paylaşımı

- **Kamera paylaşımı** — web kameranı tüm kanal üyeleriyle paylaş
- **Ekran paylaşımı** — yapılandırılabilir çözünürlük (720p / 1080p) ve kare hızı (30 / 60 fps)
- **Spotlight + şerit düzeni** — aktif akış büyük bir spotlight alanını doldurur; diğer tüm akışlar altında kaydırılabilir küçük resim şeridinde görünür
- **Spotlight'a al** — şeritteki herhangi bir küçük resme tıklayarak onu spotlight'a getir
- **Tam ekran** — spotlight'ı tek tıkla tam ekrana al
- **Ayna modu** — yerel kamera önizlemesini yatay olarak çevir

#### Sohbet ve Dosyalar

- **Metin sohbeti** — WebRTC veri kanalları üzerinden gerçek zamanlı mesajlar; sunucu dahil değil
- **Emoji seçici** — 36 emojili yerleşik emoji paneli, imleç konumuna ekler
- **Dosya transferi** — sürükle-bırak veya ek düğmesi; dosyalar WebRTC veri kanalları üzerinden doğrudan 16 KB parçalar halinde ikili veri olarak gönderilir
- **Dosya ilerleme çubuğu** — dosya alınırken canlı ilerleme göstergesi
- **Resim önizleme** — alınan resim dosyaları sohbette satır içi gösterilir

#### Bağlantı ve UX

- **Bağlantı kalitesi göstergesi** — her katılımcıda renk kodlu RTT noktası (yeşil < 80 ms / sarı < 200 ms / kırmızı ≥ 200 ms)
- **Otomatik yeniden bağlanma** — beklenmeyen bağlantı kopuklukları için üstel geri çekilmeli yeniden bağlanma (1,5 s × 2ⁿ, maksimum 30 s)
- **Katılma/ayrılma ses efektleri** — katılımcılar kanala girip çıktığında ince sesli bildirimler
- **Kullanıcı başına profil renkleri** — her kullanıcı adı, ismin hash'inden türetilen tutarlı bir renge sahiptir
- **Son kullanılan kullanıcı adı hafızası** — kullanıcı adın oturumlar arasında hatırlanır
- **Özel sinyal sunucusu** — uygulamayı kanal ekranından veya oda içi ayarlar panelinden kendi sinyal sunucuna yönlendir
- **Çerçevesiz pencere** — küçültme, büyütme ve kapatma kontrollerine sahip özel başlık çubuğu

---

### Sinyal Sunucusu

StorMIC'in çalışması için bir sinyal sunucusu gereklidir. Sunucu; küçük, durumsuz bir WebSocket aktarıcısıdır — hesap yok, depolama yok, mesaj geçmişi yok. Aşağıdakiler için **[`StorMIC-Backend/README.md`](https://github.com/MMetehan/StorMIC-Backend/blob/main/README.md)** dosyasına bak:

- Sunucuyu yerel olarak çalıştırma
- Render.com veya Heroku'ya deploy etme
- Tam WebSocket mesaj protokolü

Sunucun hazır olduğunda, build almadan önce URL'yi `.env` dosyasında yapılandır (aşağıya bak) veya çalışma zamanında uygulama içindeki Ayarlar paneli → Sinyal Sunucusu URL alanından ayarla.

---

### Mimari

```
Electron İstemcisi
├── Ana İşlem         src/main.js              — Pencere yaşam döngüsü, IPC, ekran yakalama
├── Preload           src/preload.js           — Context bridge: pencere kontrolleri + sinyal URL
└── Renderer          src/renderer/
    ├── index.html    — Ekran işaretlemesi (kullanıcı adı → kanal → oda)
    ├── signal-url.js — Build zamanında .env'den otomatik üretilir (gitignored)
    ├── styles.css    — Karanlık tema, düzen, bileşenler
    └── app.js        — Tüm iş mantığı (~1500 satır, vanilla JS)
```

#### Nasıl Çalışır

1. **Sinyalleşme** — Bir kanala katılırken istemci, sinyal sunucusuna WebSocket açar ve kanal kodu, kullanıcı adı ve niyet (`create` veya `join`) içeren bir `join` mesajı gönderir. Sunucu mevcut kullanıcıların listesiyle yanıt verir. İstemci her kullanıcı için bir `RTCPeerConnection` oluşturur ve sunucu aracılığıyla teklif/yanıt el sıkışmasını başlatır.

2. **WebRTC** — ICE müzakeresi tamamlandıktan sonra ses, video, sohbet ve dosyalar dahil tüm iletişim doğrudan eşten eşe akar. Sinyal sunucusu artık dahil değildir.

3. **Veri kanalları** — Sohbet mesajları, dosya meta verileri, dosya parçaları, konuşma durumu ve video track duyuruları; her kullanıcı çifti için tek bir sıralı WebRTC veri kanalı üzerinden iletilir. İkili parçalar, JSON kontrol mesajlarından tür denetimi ile ayırt edilir.

4. **Video tile yönetimi** — Kullanıcı kamerasını veya ekran paylaşımını etkinleştirdiğinde, tüm kullanıcılara veri kanalı üzerinden `video-track` mesajı (WebRTC track ID ve tür içerir) yayınlar. Alıcı taraf hem track'i (`pc.ontrack` ile) hem de mesajı bekler; hangisi önce gelirse tamponlanır ve diğeri geldiğinde tile oluşturulur.

5. **Çakışma çözümü** — İki kullanıcı aynı anda teklif başlattığında (WebRTC glare), `initiator: true` olan kullanıcı kazanır ve gelen teklif göz ardı edilir.

---

### Teknoloji Yığını

| Katman          | Teknoloji                                      |
| --------------- | ---------------------------------------------- |
| Masaüstü kabuğu | Electron 31                                    |
| WebRTC          | Native tarayıcı API'leri (`RTCPeerConnection`) |
| Ses analizi     | Web Audio API (`AnalyserNode`)                 |
| Medya yakalama  | `getUserMedia`, `getDisplayMedia`              |
| Arayüz          | Vanilla JS, HTML5, CSS3 — framework yok        |
| Kalıcı depolama | Yalnızca `localStorage`                        |
| Build           | electron-builder 24                            |

---

### Sinyal Sunucusu URL'si — `.env` Kurulumu

Sinyal sunucusu URL'si **depoda hiçbir zaman saklanmaz**. Build alınırken `.env` dosyasından okunur ve uygulamanın içine gömülür.

```bash
# 1. Örnek dosyayı kopyala
cp .env.example .env

# 2. .env dosyasını düzenle ve sunucu URL'sini gir
#    Örnek: STORMIC_SIGNAL_URL=wss://sunucun.example.com
```

`.env` dosyası ve üretilen `src/renderer/signal-url.js` dosyası gitignored'dur. URL asla sürüm kontrolüne girmez.

**Çalışma zamanında öncelik sırası:**

1. `localStorage` — kullanıcının uygulama içi Ayarlar panelinden manuel ayarladığı URL (her şeyi geçersiz kılar)
2. `signal-url.js` — build sırasında `.env`'den gömülen URL
3. `process.env.STORMIC_SIGNAL_URL` — sistem ortam değişkeni (gelişmiş kurulumlar için)
4. Boş — kullanıcı URL'yi uygulama Ayarları'ndan yapılandırmalıdır

---

### Kurulum ve Geliştirme

**Gereksinimler:** Node.js ≥ 18, npm

```bash
# 1. .env dosyasını oluştur (yukarıya bak)
cp .env.example .env
# .env dosyasını düzenle

# 2. Bağımlılıkları yükle ve uygulamayı başlat
make install
make dev

# 3. Ayrı bir terminalde yerel sinyal sunucusunu başlat
make server
```

`make dev`, Electron'u başlatmadan önce otomatik olarak `scripts/generate-env.js` çalıştırır; dolayısıyla `signal-url.js` her zaman `.env`'den üretilir.

`.env` yoksa veya `STORMIC_SIGNAL_URL` ayarlanmamışsa uygulama varsayılan URL olmadan başlar — URL'yi Ayarlar panelinden (⚙) veya kanal ekranındaki "Sunucu Ayarı" bölümünden yapılandırabilirsin.

---

### Dağıtım İçin Build Alma

```bash
# Önce .env dosyasını oluştur (gerekli — URL yoksa build uyarı verir)
cp .env.example .env
# .env dosyasını prodüksiyon sunucu URL'siyle düzenle

make mac      # macOS — .dmg üretir (x64 + arm64 evrensel)
make win      # Windows — NSIS .exe installer üretir (x64)
make linux    # Linux — .AppImage üretir (x64)
make all      # Üç platform birden
make clean    # dist/ klasörünü temizle
```

Çıktılar `client/dist/` klasörüne gider.

Her build komutu önce `scripts/generate-env.js` çalıştırır; bu script `.env`'deki `STORMIC_SIGNAL_URL` değerini okur ve `src/renderer/signal-url.js` dosyasına yazar. electron-builder bu dosyayı binary içine paketler. URL gömülür ve depoda görünmez.

> **Not:** macOS build'leri macOS üzerinde alınmalıdır. Windows ve Linux build'leri uygun electron-builder toolchain'i ile macOS'tan çapraz derlenebilir.

---

### Proje Yapısı

```
client/
├── .env.example              — Gerekli ortam değişkenleri için şablon
├── .env                      — Yerel yapılandırma (gitignored, asla commit edilmez)
├── assets/
│   ├── icon.icns             — macOS uygulama ikonu
│   ├── icon.ico              — Windows uygulama ikonu
│   └── icon.png              — Linux uygulama ikonu
├── scripts/
│   └── generate-env.js       — .env'i okur, src/renderer/signal-url.js yazar
├── src/
│   ├── main.js               — Electron ana işlemi
│   ├── preload.js            — Context bridge
│   └── renderer/
│       ├── index.html        — Uygulama arayüzü
│       ├── signal-url.js     — Otomatik üretilir (gitignored)
│       ├── styles.css        — Stiller
│       └── app.js            — İş mantığı
└── package.json              — Electron + electron-builder yapılandırması
```

---

### Ayarlar ve Kalıcı Depolama

Tüm kullanıcı tercihleri `localStorage`'da saklanır:

| Anahtar                     | Varsayılan | Açıklama                           |
| --------------------------- | ---------- | ---------------------------------- |
| `stormic_username`          | —          | Son kullanılan kullanıcı adı       |
| `stormic_ptt`               | Boşluk     | PTT tuş ataması                    |
| `stormic_mic_toggle`        | —          | Mikrofon aç/kapat tuş ataması      |
| `stormic_signal_url`        | `.env`'den | Sinyal sunucusu URL geçersiz kılma |
| `stormic_input_device`      | Varsayılan | Mikrofon aygıtı ID'si              |
| `stormic_output_device`     | Varsayılan | Hoparlör aygıtı ID'si              |
| `stormic_noise_suppression` | `true`     | Gürültü engelleme                  |
| `stormic_echo_cancellation` | `true`     | Yankı azaltma                      |
| `stormic_agc`               | `false`    | Otomatik kazanım kontrolü          |
| `stormic_speak_threshold`   | `8`        | Konuşma tespiti hassasiyeti        |

---

### Lisans

[MIT](LICENSE) © 2026 StorMIC
