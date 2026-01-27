import Gun from 'gun';
import express from 'express';

const app = express();
const port = 8765;

app.use(Gun.serve);

const server = app.listen(port, () => {
    console.log(`Relay Node running at http://localhost:${port}/gun`);
});

Gun({
    web: server,
    file: 'radata', // Store data in 'radata' folder
    radisk: true,   // Ensure disk storage is enabled
    localStorage: false // Disable localStorage logic for Node
});
console.log('Gun instance initialized with file persistence in ./radata');

