const { spawnSync } = require("child_process");
const EventEmitter = require("events");
const fs = require("fs");
const inquirer = require("inquirer");
const path = require("path");
require("dotenv").config();

const chrome = path.join(
  process.env["programfiles"],
  "Google",
  "Chrome",
  "Application",
  "Chrome.exe"
);

const tokenPath = path.join(process.env.LOCALAPPDATA, "songRemover", "tokens.json");

class Spotify {
  constructor(token, refresh) {
    this.token = token;
    this.refresh = refresh;
    this.auth = Buffer.from(`${process.env.ID}:${process.env.SECRET}`).toString("base64");
  }

  /** @returns {Promise<Response>} */
  async request(method = "GET", url, body, headers) {
    const req = await fetch(url, {
      method,
      body,
      headers: {
        ...headers,
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (req.ok) return req;
    else if (req.status == 401) {
      await this.refreshToken();
      return this.request(method, url, body, headers);
    }
  }

  async refreshToken() {
    const data = await fetch(`https://accounts.spotify.com/api/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${this.auth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refresh,
      }).toString(),
    });

    const { access_token, refresh_token } = await data.json();
    fs.writeFileSync(tokenPath, JSON.stringify({ token: access_token, refresh: refresh_token }));

    this.token = access_token;
    this.refresh = refresh_token;

    return;
  }
}

async function main() {
  process.title = 'Song Remover'

  if (!fs.existsSync(tokenPath)) {
    if (!fs.existsSync(path.join(process.env.LOCALAPPDATA, "songRemover")))
      fs.mkdirSync(path.join(process.env.LOCALAPPDATA, "songRemover"));
    const ev = backend();
    const params = new URLSearchParams();
    params.set("response_type", "code");
    params.set("client_id", process.env.ID);
    params.set("scope", "playlist-read-private playlist-modify-public playlist-modify-private");
    params.set("redirect_uri", process.env.REDIRECT);
    params.set("show_dialog", "true");
    spawnSync(chrome, [`https://accounts.spotify.com/authorize?${params.toString()}`]);

    ev.once("0", () => doShit());
  } else doShit();
}

async function doShit() {
  const tokens = require(tokenPath);
  const spotify = new Spotify(tokens.token, tokens.refresh);

  const userReq = await spotify.request("GET", "https://api.spotify.com/v1/me");

  const id = (await userReq.json()).id;
  const playlistData = await spotify.request("GET", "https://api.spotify.com/v1/me/playlists");

  if (playlistData.ok) {
    function canEdit(item) {
      if (item.collaborative || item.owner.id == id) return true;

      return false;
    }
    const playlists = (await playlistData.json()).items.filter(canEdit);
    const choices = [];

    playlists.forEach((d) => {
      choices.push({ name: d.name, value: d.id, description: d.description });
    });

    inquirer
      .prompt([
        {
          type: "list",
          name: "id",
          message: "Which playlist do you want to edit",
          choices,
        },
      ])
      .then(async ({ id }) => {
        const playlistData = await spotify.request(
          "GET",
          `https://api.spotify.com/v1/playlists/${id}`
        );

        console.clear();
        console.log(`Loading Playlist Data...`);

        if (playlistData.ok) {
          const artists = {};
          const arr = (await playlistData.json()).tracks.items;

          arr.forEach((item) => {
            if (item.track.name.includes("Sex Sells")) console.log(item.track.artists);
            item.track.artists.forEach((artist) => {
              if (artists[artist.name] == undefined) artists[artist.name] = [];
              if (artists[artist.name].indexOf(item.track.uri) == -1)
                artists[artist.name].push(item.track.uri);
            });
          });

          console.clear();

          inquirer
            .prompt([
              {
                type: "checkbox",
                name: "people",
                message: "Who do you want to remove",
                choices: Object.keys(artists).sort(),
              },
            ])
            .then(async ({ people }) => {
              const data = {
                tracks: [],
              };
              const uris = [];
              people.forEach((fucker) => {
                artists[fucker].forEach((uri) => {
                  if (uris.includes(uri)) return;
                  data.tracks.push({ uri });
                  uris.push(uri);
                });
              });
              await spotify
                .request(
                  "DELETE",
                  `https://api.spotify.com/v1/playlists/${id}/tracks`,
                  JSON.stringify(data),
                  { "Content-Type": "application/json" }
                )
                .then(async (res) => {
                  if (res.ok) {
                    console.clear();
                    console.log(
                      `Successfully removed songs from ${people.join(
                        ", "
                      )} ( there still may be some songs because the spotify api is dumb as fuck )`
                    );
                  } else {
                    console.clear();
                    console.error(
                      `Something went wrong\nStatus code: ${
                        res.status
                      }\nStatus Text: ${await res.text()}`
                    );
                  }

                  setTimeout(() => process.exit(), 5000);
                });
            });
        }
      });
  }
}

function backend() {
  const express = require("express");

  const app = express();
  const fuck = new EventEmitter();

  app
    .use(express.json())
    .use(express.urlencoded({ extended: true }))
    .get("/quit", (_, res) => {
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>
  <script>
    document.addEventListener("DOMContentLoaded", () => window.close());
  </script>
</body>
</html>`);

      fuck.emit(`0`);
    })
    .get("/token", (req, res) => {
      if (!req.query.code) return res.redirect("/quit");
      if (req.query.error) return res.redirect("/quit");

      const params = new URLSearchParams();
      params.set("code", req.query.code);
      params.set("redirect_uri", process.env.REDIRECT);
      params.set("grant_type", "authorization_code");

      const auth = Buffer.from(`${process.env.ID}:${process.env.SECRET}`).toString("base64");

      fetch(`https://accounts.spotify.com/api/token`, {
        method: "POST",
        body: params.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
        },
      }).then(async (resp) => {
        if (!resp.ok) return;
        const { access_token, refresh_token } = await resp.json();

        await fs.writeFileSync(
          tokenPath,
          JSON.stringify({ token: access_token, refresh: refresh_token })
        );

        res.redirect("/quit");
      });
    })
    .listen(6578);

  return fuck;
}

main();
