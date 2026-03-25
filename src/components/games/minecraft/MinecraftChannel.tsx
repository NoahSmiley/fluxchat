import { useState } from "react";
import { Copy, Check } from "lucide-react";
import minecraftLogo from "@/assets/games/minecraft-logo.png";
import "./styles/minecraft.css";

const SERVER_IP = "mc.athion.me";

export default function MinecraftChannel() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(SERVER_IP).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mc-page">
      <div className="mc-center">
        <img src={minecraftLogo} alt="Minecraft" className="mc-logo" />
        <h1 className="mc-title">Minecraft Server</h1>
        <code className="mc-ip">{SERVER_IP}</code>
        <button className="mc-cta" onClick={handleCopy}>
          {copied ? <><Check size={18} /> Copied!</> : <><Copy size={18} /> Copy Server IP</>}
        </button>
      </div>
    </div>
  );
}
