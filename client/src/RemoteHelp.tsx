// client/src/RemoteHelp.tsx
import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type SignalData =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

type PointerEventPayload = {
  x: number; // 0–1 arası normalleştirilmiş koordinat
  y: number;
  type: "click";
};

type ChatMessage = {
  id: number;
  text: string;
  fromRole: "host" | "viewer";
  self: boolean;
};

// 6 haneli random oda ID üretici
const generateRoomId = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

type FullView = "local" | "remote" | null;

const RemoteHelp: React.FC = () => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // SAYFA AÇILDIĞINDA ID OTOMATİK DOLU GELİR
  const [roomId, setRoomId] = useState<string>(() => generateRoomId());
  const [isHost, setIsHost] = useState<boolean | null>(null); // true = ekran paylaşan
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<string>("Oda ID hazır, rolünü seç");
  const [error, setError] = useState<string | null>(null);

  // destek verenin tıkladığı noktayı host ekranında göstermek için
  const [remotePointer, setRemotePointer] =
    useState<PointerEventPayload | null>(null);

  // hangi ekran büyütüldü?
  const [fullView, setFullView] = useState<FullView>(null);

  // chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  // mobil için
  const [isMobile, setIsMobile] = useState(false);

  // socket callback'lerinde güncel değerleri kullanmak için ref
  const roomIdRef = useRef(roomId);
  const isHostRef = useRef(false);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    isHostRef.current = !!isHost;
  }, [isHost]);

  // ekran genişliğine göre mobil / desktop
  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Socket.io bağlantısı
  useEffect(() => {
   const url = "https://uzakyardim.onrender.com"; // buraya KENDI URL’INI yaz
    const socket = io(url);
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket bağlı:", socket.id);
      setStatus("Sunucuya bağlanıldı");
    });

    // Odaya yeni biri katıldığında burası çalışır
    socket.on("user-joined", async () => {
      console.log("Odaya yeni kullanıcı katıldı");
      // Eğer bu cihaz ekran paylaşan ise ve zaten stream + pc hazırsa
      if (isHostRef.current && pcRef.current && localStreamRef.current) {
        setStatus("Yeni kullanıcı için offer gönderiliyor...");
        await sendOffer();
      }
    });

    // WebRTC signal mesajları
    socket.on(
      "signal",
      async ({ from: _from, data }: { from: string; data: SignalData }) => {
        console.log("Signal alındı:", data);

        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (data.type === "offer" && !isHostRef.current) {
            // İzleyen taraf: offer alır, answer üretir
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "offer", sdp: data.sdp })
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const answerData: SignalData = {
              type: "answer",
              sdp: answer.sdp!,
            };
            socket.emit("signal", {
              roomId: roomIdRef.current,
              data: answerData,
            });

            setStatus(
              "Offer alındı, answer gönderildi. Ekran bekleniyor..."
            );
          } else if (data.type === "answer" && isHostRef.current) {
            // Ekran paylaşan taraf: answer alır
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: data.sdp })
            );
            setStatus("Bağlantı kuruldu");
          } else if (data.type === "candidate" && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (err) {
          console.error("Signal işlenirken hata:", err);
        }
      }
    );

    // DESTEK VERENİN GÖNDERDİĞİ İMLEÇ OLAYLARI (sadece host görür)
    socket.on("pointer", (payload: PointerEventPayload) => {
      if (!isHostRef.current) return;
      setRemotePointer(payload);
      // küçük bir süre sonra imleci kaybet
      setTimeout(() => {
        setRemotePointer(null);
      }, 1200);
    });

    // DİĞER TARAFTAN GELEN CHAT MESAJLARI
    socket.on(
      "chat-message",
      ({ text, role }: { text: string; role: "host" | "viewer" }) => {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            text,
            fromRole: role,
            self: false,
          },
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

  // RTCPeerConnection oluştur
  const createPeerConnection = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && roomIdRef.current) {
        const data: SignalData = {
          type: "candidate",
          candidate: event.candidate.toJSON(),
        };
        socketRef.current.emit("signal", {
          roomId: roomIdRef.current,
          data,
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

  // Host'un offer üretip göndermesi
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

  // Ekran paylaşan taraf (destek alan) – SADECE MASAÜSTÜ
  const startHost = async () => {
    setError(null);

    if (isMobile) {
      setError(
        "Mobil tarayıcılar ekran paylaşımını desteklemiyor. Destek alan cihaz masaüstü olmalı."
      );
      setStatus("Mobilde host modu kapalı");
      return;
    }

    if (!roomId.trim()) {
      setError("Önce oda ID gir");
      return;
    }
    if (!socketRef.current) {
      setError("Socket sunucusuna bağlanılamadı");
      return;
    }

    // Tarayıcı ekran paylaşımı destekliyor mu kontrol et
    const navAny = navigator as any;
    const mediaDevices = navAny.mediaDevices;

    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== "function") {
      setError(
        "Bu tarayıcı ekran paylaşımını (getDisplayMedia) desteklemiyor. " +
          "Lütfen masaüstü bir tarayıcı kullan (Mac/Windows Safari, Chrome, Edge)."
      );
      setStatus("Hata oluştu");
      return;
    }

    setIsHost(true);
    setStatus("Odaya katılınıyor (host)...");
    socketRef.current.emit("join-room", roomId);

    const pc = createPeerConnection();

    try {
      // GECİKMEYİ AZALTMAK İÇİN ÇÖZÜNÜRLÜK & FPS DÜŞÜK
      const stream: MediaStream = await mediaDevices.getDisplayMedia({
        video: {
          width: 1280,
          height: 720,
          frameRate: 15,
        },
        audio: false,
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();
      }

      stream.getTracks().forEach((t: MediaStreamTrack) =>
        pc.addTrack(t, stream)
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

  // Sadece izleyen taraf (destek veren)
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

    setIsHost(false);
    setStatus("Odaya katılınıyor (izleyici)...");
    createPeerConnection();
    socketRef.current.emit("join-room", roomId);
  };

  // Destek veren cihazda, remote videoya tıklanınca host'a koordinat gönder
  const handleRemoteClick = (
    e: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    if (!socketRef.current || !roomIdRef.current) return;
    if (isHostRef.current) return; // host tıklamıyor, sadece viewer tıklıyor

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const payload: PointerEventPayload = { x, y, type: "click" };
    socketRef.current.emit("pointer", {
      roomId: roomIdRef.current,
      ...payload,
    });
  };

  // Host tarafında, local video üzerinde imleç overlay'i
  const renderPointerOverlay = () => {
    if (!remotePointer) return null;
    return (
      <div
        style={{
          position: "absolute",
          left: `${remotePointer.x * 100}%`,
          top: `${remotePointer.y * 100}%`,
          transform: "translate(-50%, -50%)",
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "3px solid #ff4d4f",
          background: "rgba(255, 77, 79, 0.2)",
          pointerEvents: "none",
        }}
      />
    );
  };

  const regenerateRoomId = () => {
    const newId = generateRoomId();
    setRoomId(newId);
    setStatus("Yeni oturum ID oluşturuldu, rolünü seç");
  };

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setStatus("Oda ID panoya kopyalandı");
    } catch {
      setError("Panoya kopyalanamadı, ID'yi elle seçip kopyalayın.");
    }
  };

  const toggleFullView = (which: FullView) => {
    setFullView((current) => (current === which ? null : which));
  };

  // CHAT GÖNDER – rol seçilmemişse bile viewer varsay
  const sendChat = () => {
    if (!chatInput.trim()) return;
    if (!socketRef.current || !roomIdRef.current) return;

    const text = chatInput.trim();
    const role: "host" | "viewer" =
      isHost === true ? "host" : "viewer"; // null ise viewer say

    // Lokalde hemen göster (self = true)
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        text,
        fromRole: role,
        self: true,
      },
    ]);

    socketRef.current.emit("chat-message", {
      roomId: roomIdRef.current,
      text,
      role,
    });

    setChatInput("");
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
  };

  const roleLabel =
    isHost === null
      ? "Rol seçilmedi"
      : isHost
      ? "Bu cihaz: DESTEK ALAN"
      : "Bu cihaz: DESTEK VEREN";

  const baseColumns = isMobile ? "1fr" : "1fr 1fr";
  const isLocalFull = fullView === "local";
  const isRemoteFull = fullView === "remote";
  const gridColumns = isLocalFull || isRemoteFull ? "1fr" : baseColumns;
  const panelHeight =
    isLocalFull || isRemoteFull ? "70vh" : isMobile ? 220 : 260;

  return (
    <div
      style={{
        padding: isMobile ? 12 : 24,
        fontFamily: "system-ui",
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 8, fontSize: isMobile ? 20 : 24 }}>
        Web Tabanlı Uzak Yardım
      </h1>

      <div
        style={{
          marginBottom: 8,
          fontSize: 12,
          opacity: 0.8,
        }}
      >
        <div>
          <strong>Rol açıklaması:</strong>{" "}
          <span>
            <b>Destek alan</b> → Ekranını paylaşan kişi (müşteri).{" "}
            <b>Destek veren</b> → Ekranı izleyip chat + imleç ile yönlendiren
            kişi.
          </span>
        </div>
        <div>
          <strong>Not:</strong> Mobil tarayıcılar ekran paylaşımını desteklemez,
          bu yüzden{" "}
          <b>destek alan cihaz masaüstü (Mac/Windows) olmalıdır.</b>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
          fontSize: 13,
        }}
      >
        <label>
          Oda ID:{" "}
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Örn: 123456"
            style={{
              padding: 6,
              fontSize: 14,
              minWidth: 120,
              borderRadius: 4,
              border: "1px solid #ccc",
            }}
          />
        </label>

        <button
          onClick={regenerateRoomId}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Yeni oturum ID
        </button>

        <button
          onClick={copyRoomId}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ID&apos;yi kopyala
        </button>

        {/* Masaüstünde host butonu aktif, mobilde devre dışı + açıklama */}
        {!isMobile ? (
          <button
            onClick={startHost}
            disabled={sharing}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              cursor: sharing ? "not-allowed" : "pointer",
            }}
          >
            Bu cihaz ekranını paylaşsın (destek alan)
          </button>
        ) : (
          <button
            onClick={startHost}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              cursor: "not-allowed",
              opacity: 0.6,
            }}
          >
            Destek alan (mobilde kapalı)
          </button>
        )}

        <button
          onClick={startViewer}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Bu cihaz sadece izlesin (destek veren)
        </button>
      </div>

      <div style={{ marginBottom: 8, fontSize: 12 }}>
        <strong>Durum:</strong> {status}
        {" • "}
        <strong>{roleLabel}</strong>
      </div>

      {error && (
        <div style={{ color: "red", marginBottom: 12, fontSize: 12 }}>
          <strong>Hata:</strong> {error}
        </div>
      )}

      {/* VİDEO ALANI */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridColumns,
          gap: 12,
        }}
      >
        {/* HOST ÖN İZLEME + İMLEÇ OVERLAY */}
        <div
          style={{
            position: "relative",
            display: isRemoteFull ? "none" : "block",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
              fontSize: 13,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14 }}>Bu cihazın ekranı (local)</h3>
            <button
              onClick={() => toggleFullView("local")}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {isLocalFull ? "Küçült" : "Büyüt"}
            </button>
          </div>
          <div
            style={{
              position: "relative",
              width: "100%",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#000",
              minHeight: panelHeight,
              maxHeight: panelHeight,
              overflow: "hidden",
            }}
          >
            <video
              ref={localVideoRef}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
              autoPlay
              muted
              playsInline
            />
            {renderPointerOverlay()}
          </div>
        </div>

        {/* REMOTE GÖRÜNTÜ – DESTEK VEREN BURAYA TIKLAR */}
        <div
          style={{
            position: "relative",
            display: isLocalFull ? "none" : "block",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
              fontSize: 13,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14 }}>
              Karşı tarafın ekranı (remote)
            </h3>
            <button
              onClick={() => toggleFullView("remote")}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {isRemoteFull ? "Küçült" : "Büyüt"}
            </button>
          </div>
          <div
            onClick={handleRemoteClick}
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#000",
              minHeight: panelHeight,
              maxHeight: panelHeight,
              overflow: "hidden",
              cursor: isHost ? "default" : "crosshair",
            }}
          >
            <video
              ref={remoteVideoRef}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
              autoPlay
              muted
              playsInline
            />
          </div>
          {!isHost && (
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>
              İpucu: Bu alanın üzerine tıkladığında, karşı tarafta kırmızı bir
              işaret görünür.
            </div>
          )}
        </div>
      </div>

      {/* CHAT ALANI */}
      <div
        style={{
          marginTop: 16,
        }}
      >
        <h3 style={{ marginBottom: 6, fontSize: 14 }}>Canlı Chat</h3>
        <div
          style={{
            borderRadius: 8,
            border: "1px solid #ccc",
            padding: 8,
            background: "#f9f9f9",
            maxHeight: isMobile ? 180 : 220,
            minHeight: 100,
            overflowY: "auto",
            fontSize: 13,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ opacity: 0.7 }}>
              Henüz mesaj yok. Buradan yazışarak destek verebilirsiniz.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                style={{
                  marginBottom: 4,
                  textAlign: m.self ? "right" : "left",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: m.self ? "#d1f5d3" : "#ffffff",
                    border: "1px solid #ddd",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      marginRight: 4,
                      opacity: 0.8,
                    }}
                  >
                    {m.fromRole === "host"
                      ? "Destek alan:"
                      : "Destek veren:"}
                  </span>
                  <span>{m.text}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
          }}
        >
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            placeholder="Mesaj yazın ve Enter'a basın..."
            style={{
              flex: 1,
              padding: 8,
              fontSize: 13,
              borderRadius: 4,
              border: "1px solid #ccc",
            }}
          />
          <button
            onClick={sendChat}
            style={{
              padding: "8px 12px",
              fontSize: 13,
              cursor: "pointer",
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