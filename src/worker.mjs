export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/fayaaa") {
      url.pathname = "/fayaaa/";
      return Response.redirect(url, 307);
    }

    return env.ASSETS.fetch(request);
  },
};
