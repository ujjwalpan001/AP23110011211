# AP23110011537

## Setup

```
cd logging_middleware && npm install
cd vehicle_maintence_scheduler && npm install
cd notification_app_be && npm install
```

## Run

```
node vehicle_maintence_scheduler/index.js   # port 3000
node notification_app_be/index.js           # port 3001
```

## Endpoints

- `GET /schedule` — returns optimal vehicle maintenance schedule per depot
- `GET /notifications/top?n=10` — returns top N priority notifications
