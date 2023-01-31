import Fastify from 'fastify';
import Static from '@fastify/static';
import Cookie from '@fastify/cookie';
import { createClient } from 'redis';
import { join } from 'path';
import { writeFileSync, readFileSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import multipart from '@fastify/multipart';
import { Client } from 'basic-ftp';
import { pipeline } from 'stream';
import util from 'util';


/**
{
    "name": "", // nickname for the container
    "char": '', // char for human readable drive junk
    "type": "", // think ftp, etc
    "data": { // data to make the container work
        "url": "",
        "user": "",
        password: ""
    }
}
 */
const containers = [];
try {
    const parsedContainers = JSON.parse(readFileSync(join(process.cwd(), "./data/containers.json"), "utf8"));
    for (var container of parsedContainers)
        containers.push(container);
    console.log("Loaded " + parsedContainers.length + " containers");
} catch (e) {
    console.error("Failed to get saved containers");
    try {
        mkdirSync(join(process.cwd(), "./data/"));
    } catch {}
    try {
        mkdirSync(join(process.cwd(), "./data/uploads/"));
    } catch {}
}
/**
 * 
 * @param {*} data A representation of a container
 * @returns If the container was created successfully
 */
function createContainer(data) {
    var container = {
        name: data.name || Buffer.from(`${Math.random() ** 51}`).toString('base64').replaceAll("=", ""),
        data: {}
    };
    switch (data.type) {
        case "sftp":
            container.data.secure = true;
        case "ftp":
            container.type = "ftp";
            container.data.host = data.url;
            container.data.user = data.user || "root";
            container.data.password = data.password;
            break;
        default:
            console.error("Invalid container type provided");
            return false;
    }
    const taken = [];
    for (const cont of containers) taken.push(cont.char.charCodeAt(0));
    var letter = 'a'.charCodeAt(0);
    while (taken.includes(letter)) letter++;
    container.char = String.fromCharCode(letter);
    containers.push(container);
    writeFileSync(join(process.cwd(), "./data/containers.json"), JSON.stringify(containers), "utf8");
    console.log("New container: " + container.name);
    return true;
}

function removeContainer(name) {
    for (var i = 0; i < containers.length; i++) {
        if (containers[i].name === name) {
            containers.splice(i, 1);
            writeFileSync(join(process.cwd(), "./data/containers.json"), JSON.stringify(containers), "utf8");
            console.log("Removed container: " + name);
            return true;
        }
    }
    console.error("Failed to remove container: " + name);
    return false;
}

function findContainer(containerName) {
    for (var i = 0; i < containers.length; i++) {
        if (containers[i].name === containerName) {
            return containers[i];
        }
    }
    console.error("Failed to find container: " + containerName);
    return null;
}

async function uploadFile(containerName, fileName, fileAsStream) {
    var container = findContainer(containerName);
    if (container == null) return false;
    switch (container.type) {
        case "sftp":
        case "ftp":
            try {
                await ftpClient.access({
                    host: container.data.host,
                    user: container.data.user,
                    password: container.data.password,
                    secure: container.data.secure
                });
                await ftpClient.uploadFrom(fileAsStream, fileName);
            } catch (e) {
                console.error(e);
            }
            ftpClient.close();
            return true;
        default:
            console.error("Unkown type on container: " + containerName);
            return false;
    }
}

async function downloadFile(containerName, fileName, outputStream) {
    var container = findContainer(containerName);
    if (container == null) return false;
    switch (container.type) {
        case "sftp":
        case "ftp":
            try {
                await ftpClient.access({
                    host: container.data.host,
                    user: container.data.user,
                    password: container.data.password,
                    secure: container.data.secure
                });
                await ftpClient.downloadTo(outputStream, fileName);
            } catch (e) {
                console.error(e);
            }
            ftpClient.close();
            return true;
        default:
            console.error("Unkown type on container: " + containerName);
            return false;
    }
}

const ftpClient = new Client();
ftpClient.ftp.verbose = false

const redisClient = createClient({
    url: process.env.REDIS_HOST || `redis://${process.env.HOST || 'localhost'}:6379`
});
redisClient.on('error', err => {
    console.error('Redis Client Error', err);
    process.exit(1);
});
await redisClient.connect();

const app = Fastify({
    logger: false
})
app.register(Static, {
    root: join(process.cwd(), "/")
})
app.register(Cookie, {
    secret: process.env.COOKIE_SECRET || "Fumos!"
});
app.register(multipart);

const adminKey = process.env.ADMIN_KEY || "Fumo";
const indexFilePath = process.env.INDEX_PATH || './src/index.html'
const loginFilePath = process.env.LOGIN_PATH || './src/login.html'
app.get("/", (req, res) => {
    const providedKey = req.cookies["ADMIN_KEY"];
    if (!providedKey || req.unsignCookie(providedKey).value !== adminKey) res.sendFile(loginFilePath);
    else res.sendFile(indexFilePath);
});
app.post("/frontend/validate", (req, res) => {
    const provided = req.body;
    console.log(provided === adminKey);
    if (provided === adminKey) res.setCookie("ADMIN_KEY", provided, {
        path: '/',
        signed: true
    })
    res.send({
        success: (provided === adminKey)
    })
});
app.post("/frontend/container", (req, res) => {
    const providedKey = req.cookies["ADMIN_KEY"];
    if (!providedKey || req.unsignCookie(providedKey).value !== adminKey) {
        res.callNotFound();
        return;
    }
    var data;
    try {
        data = JSON.parse(req.body);
    } catch (e) {
        res.status(200).type("text/json").send({
            result: "container_creation_fail",
            message: "JSON was expected but not provided",
            success: false
        });
        return;
    }
    if (createContainer(data)) res.status(200).type("text/json").send({
        result: "container_creation_success",
        success: true
    });
    else res.status(400).type("text/json").send({
        result: "container_creation_fail",
        message: "Unable to create container",
        success: false
    });
});
app.delete("/frontend/container", (req, res) => {
    const providedKey = req.cookies["ADMIN_KEY"];
    if (!providedKey || req.unsignCookie(providedKey).value !== adminKey) {
        res.callNotFound();
        return;
    }
    if (removeContainer(req.body)) res.status(200).type("text/json").send({
        result: "container_deletion_success",
        message: "Data associated with this container may still be present in uploads",
        success: true
    });
    else res.status(400).type("text/json").send({
        result: "container_deletion_fail",
        message: "Unable to delete container",
        success: false
    });
});
app.get("/frontend/container", (req, res) => {
    const providedKey = req.cookies["ADMIN_KEY"];
    if (!providedKey || req.unsignCookie(providedKey).value !== adminKey) {
        res.callNotFound();
        return;
    }
    const responseData = [];
    for (const container of containers) {
        const current = {};
        current.name = container.name;
        current.type = container.type;
        current.url = container.data.host;
        current.status = "TODO";
        responseData.push(current);
    }
    res.status(200).type("text/json").send(responseData);
});

app.get("/api", (req, res) => {
    res.send({
        about: "Magic",
        name: process.env.npm_package_name,
        version: process.env.npm_package_version
    });
});

const pump = util.promisify(pipeline);
app.post("/api/upload", async (req, res) => {
    const providedKey = req.headers.authorization;
    if (!providedKey || providedKey !== adminKey) {
        res.callNotFound();
        return;
    }
    const uploadContainer = req.query["Container"];
    if (!uploadContainer) {
        res.status(400).type("text/json").send({
            result: "file_upload_fail",
            message: "Missing container to upload to",
            status: false
        });
        return;
    }
    const file = await req.file();
    const newFileName = `${Date.now()}-${file.filename}`;
    if (await uploadFile(uploadContainer, newFileName, file.file)) {
        const password = req.query["Password"];
        const container = findContainer(uploadContainer);
        await redisClient.set(Buffer.from(`${uploadContainer}|${file.filename}`).toString('base64'), JSON.stringify({
            password: password,
            actualName: newFileName
        }));
        res.status(200).type("text/json").send({
            result: "file_upload_complete",
            url: `${process.env.DISPLAY_HOST || "localhost"}/${container.char}/${file.filename}`,
            password: password != null,
            success: true
        });
    } else res.status(400).type("text/json").send({
        result: "file_upload_fail",
        message: "Failed to upload file",
        success: false
    });
});

const verifyFilePath = process.env.VERIFY_PATH || './src/verify.html'
app.get("/:char/:file", async (req, res) => {
    const { char, file } = req.params;
    const providedKey = req.headers.authorization;
    var container;
    for (const cont of containers) {
        if (cont.char === char) {
            container = cont;
            break;
        }
    }
    if (container == undefined || container == null) {
        res.callNotFound();
        return;
    }
    var redisData;
    try {
        const e = await redisClient.get(Buffer.from(`${container.name}|${file}`).toString('base64'));
        if (e == null) {
            res.callNotFound();
            return;
        }
        redisData = JSON.parse(e);
    } catch (e) {
        res.callNotFound();
        // res.status(500).type("text/json").send({
        //     result: "file_download_fail",
        //     message: "Unable to pull redis data",
        //     success: false
        // });
        return;
    }
    if (redisData?.password !== undefined) {
        if (providedKey !== adminKey && redisData?.password !== providedKey) {
            await res.status(401).sendFile(verifyFilePath);
            return;
        }
    }
    const loc = "./data/uploads/" + redisData.actualName;
    await downloadFile(container.name, redisData.actualName, createWriteStream(loc));
    await res.sendFile(loc);
    unlinkSync(loc);
});

app.listen({ port: parseInt(process.env.PORT || '80') , host: process.env.HOST || 'localhost' }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server has started on ${address}`);
})