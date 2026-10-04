import { useNavigate } from "react-router-dom";
import { useHeartWipe } from "../components/HeartWipe";
import logoUrl from "../assets/soulmateslogo.png";
import titleshadowUrl from "../assets/titleshadow.png";
import dl1 from "../assets/download (1).png";
import dl2 from "../assets/download (2).png";
import dl3 from "../assets/download (3).png";
import dl4 from "../assets/download (4).png";

const IMAGES = [dl1, dl2, dl3, dl4];

const FLOATERS = [
  { img: 0, left: 5,  size: 70,  duration: 12, delay: 0   },
  { img: 1, left: 15, size: 50,  duration: 16, delay: 2   },
  { img: 2, left: 28, size: 90,  duration: 10, delay: 5   },
  { img: 3, left: 40, size: 60,  duration: 14, delay: 1   },
  { img: 0, left: 52, size: 80,  duration: 11, delay: 7   },
  { img: 1, left: 63, size: 45,  duration: 17, delay: 3   },
  { img: 2, left: 73, size: 75,  duration: 13, delay: 9   },
  { img: 3, left: 82, size: 55,  duration: 15, delay: 4   },
  { img: 0, left: 90, size: 65,  duration: 12, delay: 6   },
  { img: 2, left: 47, size: 85,  duration: 18, delay: 8   },
];

export default function Title() {
  const navigate = useNavigate();
  const wipe = useHeartWipe();

  return (
    <div className="relative overflow-hidden min-h-screen flex flex-col items-center justify-between py-[15vh] bg-gradient-to-b from-sky-300 via-pink-300 to-purple-500">

      {/* White diagonal stripe */}
      <div className="absolute pointer-events-none z-0 bg-white/50 w-[60%] h-[200%] -top-1/2 left-[20%] -rotate-30" />

      {/* Titleshadow */}
      <img src={titleshadowUrl} alt="" className="absolute inset-0 w-screen h-screen object-cover pointer-events-none z-[1]" />

      {/* Floating icons */}
      {FLOATERS.map((f, i) => (
        <img
          key={i}
          src={IMAGES[f.img]}
          alt=""
          className="title-floater absolute bottom-[-120px] pointer-events-none z-[3]"
          style={{
            left: `${f.left}%`,
            width: `${f.size}px`,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
          }}
        />
      ))}

      {/* Logo */}
      <img src={logoUrl} alt="Soulmates" className="relative z-[2] w-[60%] max-w-[480px] mx-auto" />

      {/* Start button */}
      <button onClick={() => wipe(() => navigate("/lobby"))} className="title-start">
        Start
      </button>
    </div>
  );
}
