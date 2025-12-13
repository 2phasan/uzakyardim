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
  x: number; // 0–1 arası oransal koordinat
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
    "Oda ID gir veya hazır ID ile devam et."
  );
  const [error, setError] = useState<string | null>(null);

  // chat
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const nextChatIdRef = useRef(1);

  // pointer
  const [remotePointer, setRemotePointer] = useState<PointerData | null>(null);

  // video büyütme
  const [enlarged, setEnlarged] = useState<"LOCAL" | "REMOTE" | "NONE">(
    "NONE"
  );

  // ref'ler (callbacklerde güncel değeri kullanmak için)
  const roomIdRef = useRef(roomId);
  const roleRef = useRef<"HOST" | "VIEWER" | null>(null);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // basit mobil kontrolü (sadece iOS/Android'i mobile sayıyoruz)
  const [isMobile] = useState(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    return isAndroid || isiOS;
  });

  // Socket.io bağlantısı
  useEffect(() => {
    // !! Buraya Render URL'ini yaz !!
    const url = "https://uzakyardim.onrender.com"; // ÖRNEK: kendi Render adresinle aynı olmalı

    const socket = io(url, {
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket bağlı:", socket.id);
      setStatus("Sunucuya bağlanıldı. Oda ID seç.");
    });

    socket.on("user-joined", async () => {
      console.log("Odaya yeni kullanıcı katıldı");
      if (roleRef.current === "HOST" && pcRef.current && localStreamRef.current) {
        setStatus("Yeni kullanıcı için offer gönderiliyor...");
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

            setStatus("Offer alındı, answer gönderildi. Ekran bekleniyor...");
          } else if (data.type === "answer" && roleRef.current === "HOST") {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: data.sdp })
            );
            setStatus("Bağlantı kuruldu");
          } else if (data.type === "candidate" && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (err) {
          console.error("Signal işlenirken hata:", err);
          setError("Sinyal işlenirken hata oluştu");
        }
      }
    );

    // pointer
    socket.on("pointer", (data: PointerData) => {
      setRemotePointer(data);
      // pointer'ı kısa süre sonra gizleyelim
      setTimeout(() => setRemotePointer(null), 1200);
    });

    // chat
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
      console.log("Socket koptu");
      setStatus("Sunucudan koptu");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // PeerConnection oluştur
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
      console.log("Remote track geldi");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
    return pc;
  };

  // Host tarafında offer oluşturup gönder
  const sendOffer = async () => {
    if (!socketRef.current || !pcRef.current || !roomIdRef.current) return;

    const pc = pcRef.current;
    setStatus("Offer oluşturuluyor...");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const data: SignalData = { type: "offer", sdp: offer.sdp! };
    socketRef.current.emit("signal", { roomId: roomIdRef.current, data });

    setStatus("Offer gönderildi, answer bekleniyor...");
  };

  // Ekran paylaşan taraf (DESTEK ALAN)
  const startHost = async () => {
    setError(null);

    if (!roomId.trim()) {
      setError("Önce oda ID gir");
      return;
    }
    if (!socketRef.current) {
      setError("Socket sunucusuna bağlanılamadı");
      return;
    }

    // Mobilde host'a izin verme: burada bloklayacağız (butonu hiçbir zaman disabled yapmıyoruz).
    if (isMobile) {
      setError(
        "Mobil tarayıcılar ekran paylaşımını tam olarak desteklemiyor. Destek alan cihaz masaüstü (Mac/Windows) olmalı."
      );
      setStatus("Host modu bu cihazda desteklenmiyor (mobil).");
      return;
    }

    setRole("HOST");
    setStatus("Odaya katılınıyor (host)...");
    createPeerConnection();
    socketRef.current.emit("join-room", roomId);

    const pc = pcRef.current!;
    try {
      if (
        !(
          (navigator as any).mediaDevices &&
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
      setStatus("Ekran paylaşımı başlatıldı. İzleyici bekleniyor...");

      const [videoTrack] = stream.getVideoTracks();
      videoTrack.addEventListener("ended", () => {
        setSharing(false);
        setStatus("Ekran paylaşımı durdu");
        localStreamRef.current = null;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      });

      await sendOffer();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ekran paylaşımı başlatılamadı");
      setStatus("Hata oluştu");
    }
  };

  // Sadece izleyen taraf (DESTEK VEREN)
  const startViewer = () => {
    setError(null);

    if (!roomId.trim()) {
      setError("Önce oda ID gir");
      return;
    }
    if (!socketRef.current) {
      setError("Socket sunucusuna bağlanılamadı");
      return;
    }

    setRole("VIEWER");
    setStatus("Odaya katılınıyor (izleyici)...");
    createPeerConnection();
    socketRef.current.emit("join-room", roomId);
  };

  const handleNewRoomId = () => {
    const newId = createRandomRoomId();
    setRoomId(newId);
    setStatus("Yeni oturum ID üretildi. Bu ID’yi karşı tarafla paylaş.");
    setRole(null);
    setRemotePointer(null);
    setChatMessages([]);
  };

  const handleCopyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setStatus("Oda ID panoya kopyalandı");
    } catch {
      setError("Panoya kopyalanamadı, elle kopyalayın");
    }
  };

  // chat gönder
  const sendChat = () => {
    if (!chatInput.trim() || !socketRef.current || !roomIdRef.current) return;

    const text = chatInput.trim();
    const fromRole = roleRef.current ?? "VIEWER";

    // önce local ekleyelim
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

  // pointer gönder (destek veren taraf, remote videoya tıkladığında)
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
      ? "BU CİHAZ: DESTEK ALAN"
      : role === "VIEWER"
      ? "BU CİHAZ: DESTEK VEREN"
      : "BU CİHAZ: ROL SEÇİLMEDİ";

  const isLocalBig = enlarged === "LOCAL";
  const isRemoteBig = enlarged === "REMOTE";

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui",
        maxWidth: 1100,
        margin: "0 auto",
        color: "#f5f5f5",
        background: "#111",
        minHeight: "100vh",
        boxSizing: "border-box"
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 4 }}>Web Tabanlı Uzak Yardım</h1>

      <p style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 6 }}>
        <strong>Rol açıklaması:</strong> <strong>Destek alan</strong> → Ekranını
        paylaşan kişi (müşteri). <strong>Destek veren</strong> → Ekranı izleyip
        chat + imleç ile yönlendiren kişi.
        <br />
        <strong>Not:</strong> Mobil tarayıcılar ekran paylaşımını
        desteklemez, bu yüzden <strong>destek alan cihaz masaüstü</strong>{" "}
        (Mac/Windows) olmalıdır.
      </p>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "wrap"
        }}
      >
        <label style={{ fontSize: 14 }}>
          Oda ID:{" "}
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{
              padding: 6,
              fontSize: 14,
              minWidth: 120,
              borderRadius: 4,
              border: "1px solid #555",
              background: "#222",
              color: "#f5f5f5"
            }}
          />
        </label>

        <button
          onClick={handleNewRoomId}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid #555",
            background: "#222"
          }}
        >
          Yeni oturum ID
        </button>

        <button
          onClick={handleCopyRoomId}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid #555",
            background: "#222"
          }}
        >
          ID&apos;yi kopyala
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10
        }}
      >
        <button
          onClick={startHost}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            cursor: "pointer",
            borderRadius: 6,
            border: "1px solid #4b8bff",
            background: "#1b1f3b"
          }}
        >
          Destek alan (mobilde kapalı)
        </button>

        <button
          onClick={startViewer}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            cursor: "pointer",
            borderRadius: 6,
            border: "1px solid #555",
            background: "#222"
          }}
        >
          Bu cihaz sadece izlesin (destek veren)
        </button>
      </div>

      <div style={{ marginBottom: 8, fontSize: 14 }}>
        <strong>Durum:</strong> {status} · <strong>{roleLabel}</strong>
      </div>

      {isMobile && (
        <div style={{ color: "#ff9800", marginBottom: 6, fontSize: 12 }}>
          Bu cihaz mobil olarak algılandı. Burada sadece{" "}
          <strong>destek veren</strong> rolü önerilir.
        </div>
      )}

      {error && (
        <div style={{ color: "red", marginBottom: 10, fontSize: 13 }}>
          <strong>Hata:</strong> {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            enlarged === "NONE" ? "1fr 1fr" : "minmax(0, 1fr)",
          gap: 12,
          alignItems: "stretch",
          marginBottom: 12
        }}
      >
        {/* LOCAL */}
        <div
          style={{
            display:
              enlarged === "REMOTE" ? "none" : "flex",
            flexDirection: "column"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 4,
              fontSize: 14
            }}
          >
            <span>
              <strong>Bu cihazın ekranı (local)</strong>
              {sharing ? " · Paylaşılıyor" : ""}
            </span>
            <button
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 12,
                border: "1px solid #555",
                background: "#222",
                cursor: "pointer"
              }}
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
            style={{
              width: "100%",
              borderRadius: 10,
              border: "1px solid #444",
              background: "#000",
              minHeight: 220
            }}
            autoPlay
            muted
            playsInline
          />
        </div>

        {/* REMOTE */}
        <div
          style={{
            display:
              enlarged === "LOCAL" ? "none" : "flex",
            flexDirection: "column"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 4,
              fontSize: 14
            }}
          >
            <span>
              <strong>Karşı tarafın ekranı (remote)</strong>
            </span>
            <button
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 12,
                border: "1px solid #555",
                background: "#222",
                cursor: "pointer"
              }}
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
            style={{
              position: "relative",
              width: "100%",
              borderRadius: 10,
              border: "1px solid #444",
              background: "#000",
              minHeight: 220,
              overflow: "hidden",
              cursor: role === "VIEWER" ? "crosshair" : "default"
            }}
            onClick={role === "VIEWER" ? handleRemoteClick : undefined}
          >
            <video
              ref={remoteVideoRef}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain"
              }}
              autoPlay
              muted
              playsInline
            />
            {remotePointer && (
              <div
                style={{
                  position: "absolute",
                  left: `${remotePointer.x * 100}%`,
                  top: `${remotePointer.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border: "2px solid red",
                  boxShadow: "0 0 8px red",
                  pointerEvents: "none"
                }}
              />
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#aaa",
              marginTop: 4
            }}
          >
            İpucu: Bu alanın üzerine tıkladığında, karşı tarafta kırmızı bir
            işaret görünür.
          </div>
        </div>
      </div>

      {/* Chat */}
      <div
        style={{
          borderTop: "1px solid #333",
          paddingTop: 8,
          marginTop: 8
        }}
      >
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Canlı Chat</h3>
        <div
          style={{
            maxHeight: 160,
            overflowY: "auto",
            padding: 8,
            borderRadius: 8,
            border: "1px solid #333",
            background: "#181818",
            marginBottom: 6
          }}
        >
          {chatMessages.length === 0 && (
            <div style={{ fontSize: 12, color: "#aaa" }}>
              Henüz mesaj yok. Aşağıdan mesaj yazmaya başlayabilirsin.
            </div>
          )}
          {chatMessages.map((m) => (
            <div
              key={m.id}
              style={{
                marginBottom: 4,
                fontSize: 13,
                textAlign: m.from === "HOST" ? "right" : "left"
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 8px",
                  borderRadius: 8,
                  background:
                    m.from === "HOST" ? "#3552b5" : "#333",
                  maxWidth: "80%"
                }}
              >
                <strong style={{ fontSize: 11 }}>
                  {m.from === "HOST" ? "Destek alan" : "Destek veren"}:
                </strong>{" "}
                {m.text}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6
          }}
        >
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            placeholder="Mesaj yaz..."
            style={{
              flex: 1,
              padding: 6,
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid #555",
              background: "#222",
              color: "#f5f5f5"
            }}
          />
          <button
            onClick={sendChat}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid #4b8bff",
              background: "#1b1f3b",
              cursor: "pointer"
            }}
          >
            Gönder
          </button>
        </div>
      </div>
    </div>
  );
};

export default RemoteHelp;