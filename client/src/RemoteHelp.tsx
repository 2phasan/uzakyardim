// client/src/RemoteHelp.tsx
import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type SignalData =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

type ChatMessage = {
  id: number;
  from: "HOST" | "VIEWER";
  text: string;
};

type PointerData = {
  x: number; // 0–1 arası
  y: number;
};

const createRandomRoomId = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const RemoteHelp: React.FC = () => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [roomId, setRoomId] = useState<string>(createRandomRoomId());
  const [role, setRole] = useState<"HOST" | "VIEWER" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<string>(
    "Oda ID oluşturun veya hazır ID ile devam edin."
  );
  const [error, setError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const nextChatIdRef = useRef(1);

  const [remotePointer, setRemotePointer] = useState<PointerData | null>(null);
  const [enlarged, setEnlarged] = useState<"LOCAL" | "REMOTE" | "NONE">(
    "NONE"
  );

  const roomIdRef = useRef(roomId);
  const roleRef = useRef<"HOST" | "VIEWER" | null>(null);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // Mobil tespiti (host için engelleme mesajı göstereceğiz)
  const [isMobile] = useState(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    return isAndroid || isiOS;
  });

  // Socket.io bağlantısı
  useEffect(() => {
    const url = "https://uzakyardim.onrender.com"; // Render’daki server adresin
    const socket = io(url, {
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Signaling sunucusuna bağlanıldı.");
    });

    socket.on("user-joined", async () => {
      if (roleRef.current === "HOST" && pcRef.current && localStreamRef.current) {
        setStatus("Yeni kullanıcı için bağlantı oluşturuluyor...");
        await sendOffer();
      }
    });

    socket.on(
      "signal",
      async ({ data }: { from: string; data: SignalData }) => {
        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (data.type === "offer" && roleRef.current === "VIEWER") {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "offer", sdp: data.sdp })
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const answerData: SignalData = {
              type: "answer",
              sdp: answer.sdp!
            };
            socket.emit("signal", {
              roomId: roomIdRef.current,
              data: answerData
            });

            setStatus("Bağlantı isteği alındı, yanıt gönderildi.");
          } else if (data.type === "answer" && roleRef.current === "HOST") {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: data.sdp })
            );
            setStatus("Görüntü bağlantısı kuruldu.");
          } else if (data.type === "candidate" && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (err) {
          console.error("Signal işlenirken hata:", err);
          setError("Bağlantı kurulurken bir hata oluştu.");
        }
      }
    );

    // Pointer
    socket.on("pointer", (data: PointerData) => {
      setRemotePointer(data);
      setTimeout(() => setRemotePointer(null), 1200);
    });

    // Chat
    socket.on(
      "chat-message",
      ({ text, role: fromRole }: { text: string; role: "HOST" | "VIEWER" }) => {
        setChatMessages((prev) => [
          ...prev,
          {
            id: nextChatIdRef.current++,
            from: fromRole,
            text
          }
        ]);
      }
    );

    socket.on("disconnect", () => {
      setStatus("Signaling sunucusuyla bağlantı koptu.");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const createPeerConnection = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && roomIdRef.current) {
        const data: SignalData = {
          type: "candidate",
          candidate: event.candidate.toJSON()
        };
        socketRef.current.emit("signal", {
          roomId: roomIdRef.current,
          data
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const sendOffer = async () => {
    if (!socketRef.current || !pcRef.current || !roomIdRef.current) return;

    const pc = pcRef.current;
    setStatus("Bağlantı isteği hazırlanıyor...");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const data: SignalData = { type: "offer", sdp: offer.sdp! };
    socketRef.current.emit("signal", { roomId: roomIdRef.current, data });

    setStatus("Bağlantı isteği gönderildi, yanıt bekleniyor...");
  };

  // Host (destek alan)
  const startHost = async () => {
    setError(null);

    if (!roomId.trim()) {
      setError("Önce geçerli bir Oda ID girin.");
      return;
    }
    if (!socketRef.current) {
      setError("Signaling sunucusuna bağlanılamadı.");
      return;
    }

    if (isMobile) {
      setError(
        "Mobil tarayıcılar ekran paylaşımını desteklemez. Destek alan cihazın masaüstü (Mac/Windows) olması gerekir."
      );
      setStatus("Host modu bu cihazda kullanılamıyor (mobil).");
      return;
    }

    setRole("HOST");
    setStatus("Odaya katılınıyor (destek alan)...");
    createPeerConnection();
    socketRef.current.emit("join-room", roomId);

    const pc = pcRef.current!;
    try {
      if (
        !(
          navigator.mediaDevices &&
          (navigator.mediaDevices as any).getDisplayMedia
        )
      ) {
        throw new Error(
          "Bu tarayıcı ekran paylaşımını (getDisplayMedia) desteklemiyor."
        );
      }

      const stream: MediaStream = await (navigator.mediaDevices as any)
        .getDisplayMedia({
          video: true,
          audio: false
        });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();
      }

      stream.getTracks().forEach((track: MediaStreamTrack) =>
        pc.addTrack(track, stream)
      );
      setSharing(true);
      setStatus("Ekran paylaşımı başladı. Destek veren bağlanabilir.");

      const [videoTrack] = stream.getVideoTracks();
      videoTrack.addEventListener("ended", () => {
        setSharing(false);
        setStatus("Ekran paylaşımı sonlandırıldı.");
        localStreamRef.current = null;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      });

      await sendOffer();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ekran paylaşımı başlatılamadı.");
      setStatus("Hata oluştu.");
    }
  };

  // Viewer (destek veren)
  const startViewer = () => {
    setError(null);

    if (!roomId.trim()) {
      setError("Önce geçerli bir Oda ID girin.");
      return;
    }
    if (!socketRef.current) {
      setError("Signaling sunucusuna bağlanılamadı.");
      return;
    }

    setRole("VIEWER");
    setStatus("Odaya katılınıyor (destek veren)...");
    createPeerConnection();
    socketRef.current.emit("join-room", roomId);
  };

  const handleNewRoomId = () => {
    const newId = createRandomRoomId();
    setRoomId(newId);
    setStatus("Yeni oturum ID oluşturuldu. Bu ID’yi karşı tarafla paylaşın.");
    setRole(null);
    setRemotePointer(null);
    setChatMessages([]);
  };

  const handleCopyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setStatus("Oda ID panoya kopyalandı.");
    } catch {
      setError("Panoya kopyalanamadı, ID’yi elle kopyalayın.");
    }
  };

  const sendChat = () => {
    if (!chatInput.trim() || !socketRef.current || !roomIdRef.current) return;

    const text = chatInput.trim();
    const fromRole = roleRef.current ?? "VIEWER";

    setChatMessages((prev) => [
      ...prev,
      { id: nextChatIdRef.current++, from: fromRole, text }
    ]);

    socketRef.current.emit("chat-message", {
      roomId: roomIdRef.current,
      text,
      role: fromRole
    });

    setChatInput("");
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
  };

  const handleRemoteClick = (
    e: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    if (!socketRef.current || !roomIdRef.current) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    socketRef.current.emit("pointer", {
      roomId: roomIdRef.current,
      x,
      y
    });
  };

  const roleLabel =
    role === "HOST"
      ? "Bu cihaz: DESTEK ALAN"
      : role === "VIEWER"
      ? "Bu cihaz: DESTEK VEREN"
      : "Bu cihaz: ROL SEÇİLMEDİ";

  const isLocalBig = enlarged === "LOCAL";
  const isRemoteBig = enlarged === "REMOTE";

  return (
    <div className="app-shell">
      {/* HEADER */}
      <header className="app-header">
        <div className="app-logo">
          <div className="logo-mark">U</div>
          <div className="logo-text">
            <span className="logo-title">uzakyardim</span>
            <span className="logo-subtitle">Kurumsal Ekran Destek Platformu</span>
          </div>
        </div>
        <div className="header-right">
          <span className="header-badge">Beta</span>
        </div>
      </header>

      {/* MAIN */}
      <main className="app-main">
        {/* SOL PANEL: Bilgi & Durum */}
        <section className="info-panel">
          <div className="info-card">
            <h2>Nasıl Çalışır?</h2>
            <ol>
              <li>
                <strong>1.</strong> Destek alan, masaüstü cihazdan bu sayfayı
                açar, <strong>Destek alan</strong> butonuna basıp ekranını
                paylaşır.
              </li>
              <li>
                <strong>2.</strong> Destek veren, aynı Oda ID ile{" "}
                <strong>Bu cihaz sadece izlesin</strong> butonuna basar.
              </li>
              <li>
                <strong>3.</strong> Ekran otomatik olarak bağlanır; chat ve
                kırmızı imleç ile yönlendirme yapılabilir.
              </li>
            </ol>
          </div>

          <div className="info-card">
            <h2>Rol Bilgisi</h2>
            <p>
              <strong>Destek alan:</strong> Ekranını paylaşan, genellikle müşteri
              veya son kullanıcı.
              <br />
              <strong>Destek veren:</strong> Ekranı izleyip kullanıcıya adım
              adım yol gösteren uzman.
            </p>
            <p className="info-note">
              Mobil tarayıcılar ekran paylaşımını desteklemez; bu nedenle{" "}
              <strong>destek alan cihazın masaüstü</strong> olması gerekir.
            </p>
          </div>

          <div className="status-card">
            <div className="status-row">
              <span className="status-label">Oda ID</span>
              <span className="status-value">{roomId}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Cihaz Rolü</span>
              <span className="status-value">{roleLabel}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Durum</span>
              <span className="status-value status-value--accent">
                {status}
              </span>
            </div>
            {error && (
              <div className="status-error">
                <strong>Hata:</strong> {error}
              </div>
            )}
          </div>
        </section>

        {/* SAĞ PANEL: Kontroller + Video + Chat */}
        <section className="session-panel">
          {/* ODA / ROL KONTROLLERİ */}
          <div className="card controls-card">
            <div className="controls-row">
              <label className="field">
                <span className="field-label">Oda ID</span>
                <input
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="field-input"
                />
              </label>

              <button className="btn-secondary" onClick={handleNewRoomId}>
                Yeni ID
              </button>
              <button className="btn-secondary" onClick={handleCopyRoomId}>
                ID&apos;yi kopyala
              </button>
            </div>

            <div className="controls-row controls-row--buttons">
              <button className="btn-primary" onClick={startHost}>
                Destek alan (masaüstü)
              </button>
              <button className="btn-ghost" onClick={startViewer}>
                Bu cihaz sadece izlesin (destek veren)
              </button>
            </div>

            {isMobile && (
              <p className="mobile-warning">
                Bu cihaz mobil olarak algılandı. Bu cihazda{" "}
                <strong>sadece destek veren</strong> rolü kullanılmalıdır.
              </p>
            )}
          </div>

          {/* VİDEO ALANI */}
          <div className="card video-card">
            <div className="video-grid">
              {/* LOCAL */}
              <div
                className={
                  enlarged === "REMOTE" ? "video-block video-block--hidden" : "video-block"
                }
              >
                <div className="video-header">
                  <div>
                    <h3>Bu cihazın ekranı</h3>
                    <span className="video-caption">
                      {sharing
                        ? "Ekran paylaşılıyor."
                        : "Host olduğunuzda ekranınız burada görünür."}
                    </span>
                  </div>
                  <button
                    className="chip"
                    onClick={() =>
                      setEnlarged((prev) =>
                        prev === "LOCAL" ? "NONE" : "LOCAL"
                      )
                    }
                  >
                    {isLocalBig ? "Küçült" : "Büyüt"}
                  </button>
                </div>
                <video
                  ref={localVideoRef}
                  className="video-element"
                  autoPlay
                  muted
                  playsInline
                />
              </div>

              {/* REMOTE */}
              <div
                className={
                  enlarged === "LOCAL" ? "video-block video-block--hidden" : "video-block"
                }
              >
                <div className="video-header">
                  <div>
                    <h3>Karşı tarafın ekranı</h3>
                    <span className="video-caption">
                      Destek veren olarak bu alan üzerinden imleç ile yönlendirme
                      yapabilirsiniz.
                    </span>
                  </div>
                  <button
                    className="chip"
                    onClick={() =>
                      setEnlarged((prev) =>
                        prev === "REMOTE" ? "NONE" : "REMOTE"
                      )
                    }
                  >
                    {isRemoteBig ? "Küçült" : "Büyüt"}
                  </button>
                </div>

                <div
                  className={
                    role === "VIEWER"
                      ? "video-remote-wrapper video-remote-wrapper--clickable"
                      : "video-remote-wrapper"
                  }
                  onClick={role === "VIEWER" ? handleRemoteClick : undefined}
                >
                  <video
                    ref={remoteVideoRef}
                    className="video-element"
                    autoPlay
                    muted
                    playsInline
                  />
                  {remotePointer && (
                    <div
                      className="remote-pointer"
                      style={{
                        left: `${remotePointer.x * 100}%`,
                        top: `${remotePointer.y * 100}%`
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* CHAT */}
          <div className="card chat-card">
            <div className="chat-header">
              <h3>Canlı Chat</h3>
              <span className="chat-subtitle">
                Oturum içi yazılı iletişim ve kısa notlar için kullanın.
              </span>
            </div>

            <div className="chat-messages">
              {chatMessages.length === 0 && (
                <div className="chat-empty">
                  Henüz mesaj yok. Aşağıdan mesaj yazarak başlayabilirsiniz.
                </div>
              )}
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.from === "HOST"
                      ? "chat-bubble chat-bubble--host"
                      : "chat-bubble chat-bubble--viewer"
                  }
                >
                  <span className="chat-author">
                    {m.from === "HOST" ? "Destek alan" : "Destek veren"}
                  </span>
                  <span className="chat-text">{m.text}</span>
                </div>
              ))}
            </div>

            <div className="chat-input-row">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Mesaj yazın ve Enter’a basın..."
                className="chat-input"
              />
              <button className="btn-primary btn-primary--small" onClick={sendChat}>
                Gönder
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="app-footer">
        <span>© {new Date().getFullYear()} uzakyardim · Web tabanlı uzak destek çözümü</span>
        <span className="footer-hint">
          Bu sayfa test ve demo amaçlıdır. Gerçek müşteri verisi saklanmaz.
        </span>
      </footer>
    </div>
  );
};

export default RemoteHelp;