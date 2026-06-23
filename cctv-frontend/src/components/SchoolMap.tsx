import React, { useState, useEffect, useRef } from 'react';
import './SchoolMap.css';
import { useNavigate } from 'react-router-dom'

// Типы данных для камер
interface CameraZone {
  id: number;
  name: string;
  floor: number;
  coord_x: number;
  coord_y: number;
  coverage_width: number;
  coverage_height: number;
  video_url: string;
  color: string;
  colorHex: string;
}

// Данные с вашими зонами (можно вынести в отдельный файл)
const camerasData: CameraZone[] = [
  {"id":100,"name":"Столовая","floor":1,"coord_x":4.4,"coord_y":55.9,"coverage_width":38.1,"coverage_height":27.6,"video_url":"/videos/cam7.mp4","color":"green","colorHex":"#10b981"},
  {"id":102,"name":"Коридор - 1 этаж","floor":1,"coord_x":18.6,"coord_y":36.3,"coverage_width":58.6,"coverage_height":20.1,"video_url":"/videos/cam2.mp4","color":"red","colorHex":"#ef4444"},
  {"id":103,"name":"Лестница","floor":1,"coord_x":42.5,"coord_y":16.3,"coverage_width":17.4,"coverage_height":19.6,"video_url":"/videos/cam10.mp4","color":"purple","colorHex":"#8b5cf6"},
  {"id":104,"name":"Вход","floor":1,"coord_x":42.8,"coord_y":56.6,"coverage_width":17.2,"coverage_height":27.3,"video_url":"/videos/cam1.mp4","color":"orange","colorHex":"#f59e0b"},
  {"id":105,"name":"Спортзал","floor":1,"coord_x":76.6,"coord_y":16.5,"coverage_width":17.7,"coverage_height":67.7,"video_url":"/videos/cam3.mp4","color":"green","colorHex":"#10b981"},
  {"id":106,"name":"Библиотека","floor":1,"coord_x":30.1,"coord_y":16.1,"coverage_width":12.4,"coverage_height":19.8,"video_url":"/videos/cam5.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":107,"name":"Медик","floor":1,"coord_x":18.2,"coord_y":16.3,"coverage_width":11.7,"coverage_height":19.8,"video_url":"/videos/cam8.mp4","color":"pink","colorHex":"#ec489a"},
  {"id":108,"name":"Гардероб","floor":1,"coord_x":60.1,"coord_y":56.4,"coverage_width":16.2,"coverage_height":27.3,"video_url":"/videos/cam9.mp4","color":"purple","colorHex":"#8b5cf6"},
  {"id":109,"name":"Коридор - 2 этаж","floor":2,"coord_x":18.6,"coord_y":39.7,"coverage_width":58.3,"coverage_height":20.5,"video_url":"/videos/cam6.mp4","color":"red","colorHex":"#ef4444"},
  {"id":110,"name":"Лестница - 2 этаж","floor":2,"coord_x":42.5,"coord_y":18.7,"coverage_width":17.8,"coverage_height":20.7,"video_url":"/videos/cam10.mp4","color":"purple","colorHex":"#8b5cf6"},
  {"id":111,"name":"Актовый зал","floor":2,"coord_x":76.7,"coord_y":18.8,"coverage_width":17.3,"coverage_height":70.6,"video_url":"/videos/cam5.mp4","color":"green","colorHex":"#10b981"},
  {"id":112,"name":"Кабинет 1","floor":2,"coord_x":60.3,"coord_y":18.5,"coverage_width":16,"coverage_height":21,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":113,"name":"Кабинет 2","floor":2,"coord_x":18.7,"coord_y":18.7,"coverage_width":15,"coverage_height":20.7,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":114,"name":"Кабинет 3","floor":2,"coord_x":4.4,"coord_y":18.8,"coverage_width":14,"coverage_height":34,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":115,"name":"Кабинет 4","floor":2,"coord_x":4.4,"coord_y":52.7,"coverage_width":14.4,"coverage_height":36.4,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":116,"name":"Кабинет 5","floor":2,"coord_x":25.6,"coord_y":60.3,"coverage_width":17.2,"coverage_height":28.7,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":117,"name":"Кабинет 6","floor":2,"coord_x":42.7,"coord_y":60.5,"coverage_width":17,"coverage_height":28.7,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
  {"id":118,"name":"Кабинет 7","floor":2,"coord_x":59.8,"coord_y":60.3,"coverage_width":16.8,"coverage_height":28.7,"video_url":"/videos/cam4.mp4","color":"blue","colorHex":"#3b82f6"},
]

const SchoolMap: React.FC = () => {
  const [currentFloor, setCurrentFloor] = useState<number>(1);
  const [selectedCamera, setSelectedCamera] = useState<CameraZone | null>(null);
  const [videoError, setVideoError] = useState<boolean>(false);
  const navigate = useNavigate()
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const zonesLayerRef = useRef<HTMLDivElement>(null);

  // Конвертация HEX в RGB
  const hexToRgb = (hex: string): string => {
    if (!hex || !hex.startsWith('#')) return '0,0,0';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
  };

  // Рендер зон на карте
  const renderZones = () => {
    if (!zonesLayerRef.current) return;
    zonesLayerRef.current.innerHTML = '';

    const floorZones = camerasData.filter(z => z.floor === currentFloor);

    floorZones.forEach(zone => {
      const div = document.createElement('div');
      div.className = 'school-zone';
      div.style.left = `${zone.coord_x}%`;
      div.style.top = `${zone.coord_y}%`;
      div.style.width = `${zone.coverage_width}%`;
      div.style.height = `${zone.coverage_height}%`;
      div.style.borderColor = zone.colorHex;
      div.style.backgroundColor = `rgba(${hexToRgb(zone.colorHex)}, 0.2)`;
      div.setAttribute('data-id', String(zone.id));

      const label = document.createElement('div');
      label.className = 'school-zone-label';
      label.textContent = `${zone.name}`;
      label.style.backgroundColor = `${zone.colorHex}cc`;
      div.appendChild(label);

      div.addEventListener('click', (e) => {
        e.stopPropagation();
        // Анимация
        div.classList.add('zone-clicked');
        setTimeout(() => div.classList.remove('zone-clicked'), 400);
        setSelectedCamera(zone);
        setVideoError(false);
      });

      zonesLayerRef.current?.appendChild(div);
    });
  };

  useEffect(() => {
    renderZones();
  }, [currentFloor]);

  // Обработчик ошибки видео
  const handleVideoError = () => {
    setVideoError(true);
  };

  return (
    <div className="school-map-container">
      <div className="school-map-header">
        <h2>Карта видеонаблюдения школы</h2>
        <div className="floor-selector">
  <button
    className={`floor-btn ${currentFloor === 1 ? 'active' : ''}`}
    onClick={() => setCurrentFloor(1)}
  >
    1 ЭТАЖ
  </button>
  <button
    className={`floor-btn ${currentFloor === 2 ? 'active' : ''}`}
    onClick={() => setCurrentFloor(2)}
  >
    2 ЭТАЖ
  </button>
  <button
    className="floor-btn all-cameras-btn"
    onClick={() => navigate('/')}
  >
    Все камеры
  </button>
</div>
      </div>

      <div className="school-map-content">
        <div className="map-area">
          <div className="map-wrapper" ref={mapContainerRef}>
            <img
              src={`/scheme/${currentFloor}.png`}
              alt={`План ${currentFloor} этажа`}
              className="floor-image"
            />
            <div className="zones-layer" ref={zonesLayerRef}></div>
          </div>
        </div>

        <div className="camera-info-panel">
          <h3 className="text-center">Информация о камере</h3>
          {selectedCamera ? (
            <>
              <div className="camera-details">
                <div className="camera-name">{selectedCamera.name}</div>
                <div className="camera-floor">{selectedCamera.floor} этаж</div>
              </div>
              <div className="video-container">
                {!videoError ? (
                  <video
                    key={selectedCamera.video_url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    onError={handleVideoError}
                    className="camera-video w-full object-cover"
                  >
                    <source src={selectedCamera.video_url} type="video/mp4" />
                  </video>
                ) : (
                  <div className="video-placeholder">
                    Видео временно недоступно
                    <br />
                    <small>Файл: {selectedCamera.video_url}</small>
                  </div>
                )}
                <div className="video-label">
                  {selectedCamera.name} - прямая трансляция
                </div>
              </div>
            </>
          ) : (
            <div className="no-camera-selected">
              Нажмите на любую зону на карте
            </div>
          )}

          <div className="cameras-list">
            <h4 className="text-center">Список камер ({camerasData.filter(z => z.floor === currentFloor).length})</h4>
            <div className="cameras-scroll">
              {camerasData
                .filter(zone => zone.floor === currentFloor)
                .map(zone => (
                  <div
                    key={zone.id}
                    className={`camera-list-item ${selectedCamera?.id === zone.id ? 'active' : ''}`}
                    style={{ borderLeftColor: zone.colorHex }}
                    onClick={() => {
                      setSelectedCamera(zone);
                      setVideoError(false);
                      // Найти и анимировать зону на карте
                      const zoneElement = zonesLayerRef.current?.querySelector(
                        `.school-zone[data-id="${zone.id}"]`
                      ) as HTMLElement;
                      if (zoneElement) {
                        zoneElement.classList.add('zone-clicked');
                        setTimeout(() => zoneElement.classList.remove('zone-clicked'), 400);
                      }
                    }}
                  >
                    {zone.name}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes zonePulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.7); }
          50% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255,255,255,0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }

        .zone-clicked {
          animation: zonePulse 0.4s ease-out !important;
        }
      `}</style>
    </div>
  );
};

export default SchoolMap;