// ==UserScript==
// @name          Youtube Controls
// @version       0.0.1
// @description   Controls for youtube
// @author        Owen Parry
// @include       /^https:\/\/www\.youtube\.com\/.*$/
// @include       /^https:\/\/.+\.googlevideo\.com\/.*$/
// @grant         GM_xmlhttpRequest
// @grant         GM_addStyle
// @run-at        document-start
// ==/UserScript==

/*
 * It's possible to combine audio and video using https://unpkg.com/@ffmpeg/ffmpeg@0.7.0/dist/ffmpeg.min.js
 * but it requires first downloading streams to memory. It's not been implemented due to file sizes.
 */

/*
 * NOTE: youtube uses a pool for almost all elements on the page. When binding a control
 * to an element, it is important in order to prevent memory leaks or undesirable behaviour,
 * to detect when an element is removed from the DOM and unbind all controls
 */

function log(...what) {
  console.log(...what)
}

class URL extends window.URL {
  static fetch (method, url, {data, headers, responseType} = {}) {

    return new Promise((resolve, reject) => {
      var handle = function(resp) {
        if (resp.status == 200) {
          resolve(resp)
        } else {
          const error = new Error(resp.status, `Failed to fetch "${url}"`)
          error.response = resp
          reject(error)
        }
      }

      headers = Object.assign({}, {
        "User-Agent":       navigator.userAgent,
        "Accept":           "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding":  "gzip, deflate",
      }, headers || {})

      if (data) {
        headers = Object.assign({}, {
          "Content-Length": data.length + '',
          "Content-Type":   "application/x-www-form-urlencoded; charset=UTF-8"
        }, headers)
      }

      GM_xmlhttpRequest({
        method,
        url,
        data,
        headers,
        onload: handle,
        onerror: handle,
        onabort: () => { reject(new Error("GM_xmlhttpRequest aborted")) },
        responseType: responseType || "text",
      })
    })
  }
  static buildQueryString (url, data) {
    if (!data)
      return url

    function stringify (v) {
      switch (typeof v) {
        case 'string':  return v
        case 'boolean': return v ? 'true' : 'false'
        case 'number':  return isFinite(v) ? v : ''
        default:        return ''
      }
    }

    if (url)
      url += '?'
    else
      url = ''

    return url + Object.keys(data).map(key => {
      var ks = window.encodeURIComponent(stringify(key)) + '='
      if (Array.isArray(data[key])) {
        return data[key].map(val => {
          return ks + window.encodeURIComponent(stringify(val))
        }).join('&');
      } else {
        return ks + window.encodeURIComponent(stringify(data[key]))
      }
    }).filter(Boolean).join('&')
  }
  static parseQueryString (url) {
    var params
    if (url instanceof URL)
      url = url.searchParams

    if (url instanceof URLSearchParams)
      params = url
    else
      params = new URLSearchParams(url.split('?').pop())

    const data = {}
    for (const [key, value] of params) {
      if (!(key in data))
        data[key] = value
      else if (Array.isArray(data[key]))
        data[key].push(value)
      else
        data[key] = [data[key], value]
    }
    return data
  }
  static getAllResponseHeaders (headers) {
    const table = {}

    headers.trim().split(/[\r\n]+/).forEach(line => {
      const parts = line.split(': ')
      table[ parts.shift().toLowerCase() ] = parts.join(': ')
    })

    return table
  }
  static getResponseHeader (headers, key) {
    return URL.getAllResponseHeaders()[ key.toLowerCase() ]
  }

  static GET  (url, {query, headers} = {}) {
    return URL.fetch("GET", URL.buildQueryString(url, query), {headers}).then(resp => resp.responseText)
  }
  static HEAD (url, {query, headers} = {}) {
    return URL.fetch("HEAD", URL.buildQueryString(url, query), {headers})
      .then(resp => URL.getAllResponseHeaders(resp.responseHeaders))
  }
  static POST (url, data, {query, headers} = {}) {
    return URL.fetch("POST", URL.buildQueryString(url, query), {data, headers}).then(resp => resp.responseText)
  }

  static BLOB (url, {query, headers} = {}) {
    return URL.fetch("GET", URL.buildQueryString(url, query), {headers, responseType: "blob"}).then(resp => resp.response)
  }
}

class UTIL {
  static repeat (ms, callback) {
    const timer = window.setInterval(callback, ms)

    return {
      dispose: () => window.clearInterval(timer)
    }
  }
  static delay (ms, callback) {
    const timer = window.setTimeout(callback, ms)

    return {
      dispose: () => window.clearTimeout(timer)
    }
  }

  static debounce (ms, callback, options = {}) {
    const leading = "leading" in options ? !!options.leading : false
    const trailing = "trailing" in options ? !!options.trailing : true

    var last_args
    var last_context
    var result
    var timer_id
    var last_call_time
    let last_invoke_time = 0

    function invokeFunc (time) {
      const args    = last_args
      const context = last_context

      last_args = last_context = undefined
      last_invoke_time = time
      result = callback.apply(context, args)

      return result
    }

    function leadingEdge (time) {
      last_invoke_time = time
      timer_id = window.setTimeout(timerExpired, wait)

      return leading ? invokeFunc(time) : result
    }

    function trailingEdge (time) {
      timer_id = undefined

      if (trailing && last_context)
        return invokeFunc(time)

      last_args = last_context = undefined
      return result
    }

    function remainingWait (time) {
      const delta = time - last_call_time

      return ms - delta
    }

    function shouldInvoke (time) {
      const delta = time - last_call_time

      return (last_call_time === undefined || (delta >= ms) || (delta < 0))
    }

    function timerExpired () {
      const time = performance.now()

      if (shouldInvoke(time))
        return trailingEdge(time)

      timer_id = window.setTimeout(timerExpired, remainingWait(time))
    }

    return (...args) => {
      const time = performance.now()

      last_args = args
      last_context = this
      last_call_time = time

      if (timer_id === undefined) {
        if (shouldInvoke(time))
          return leadingEdge(last_call_time)

        timer_id = window.setTimeout(timerExpired, ms)
      }

      return result
    }
  }
  static throttle (ms, callback, options = {}) {
    return UTIL.debounce(ms, callback, {
      leading: "leading" in options ? !!options.leading : true,
      trailing: "trailing" in options ? !!options.trailing : true
    })
  }
}

class DOM {
  static create (template) {
    const div = document.createElement("div")
    div.innerHTML = template

    return div.firstElementChild
  }
  static on (element, event, callback) {
    element.addEventListener(event, callback)

    return {
      dispose: () => element.removeEventListener(event, callback)
    }
  }
  static once (element, event, callback) {
    var disposed = false
    const dispose = () => {
      disposed = true
      element.removeEventListener(event, callback)
    }

    element.addEventListener(event, e => {
      if (!disposed)
        callback(e)
      dispose()
    })

    return {
      dispose
    }
  }
}

class Watch {
  static get debug () { return false }

  static mutation (element, callback, options) {
    var disconnected = false
    var observer = new MutationObserver(entries => {
      for (const entry of entries) {
        if (!disconnected)
          callback(entry)
      }
    })

    observer.observe(element, options)

    return {
      dispose: () => {
        if (!disconnected) {
          disconnected = true
          observer.disconnect()
        }

        observer = null
      }
    }
  }

  static childAdditions (element, callback, options = {}) {
    return Watch.mutation(element, record => {
      for (const child of record.addedNodes)
        callback(child)
    }, {
      subtree: options.deep ? true : false,
      childList: true
    })
  }
  static childRemovals (element, callback, options = {}) {
    return Watch.mutation(element, record => {
      for (const child of record.removedNodes)
        callback(child)
    }, {
      subtree: options.deep ? true : false,
      childList: true
    })
  }

  static resize (element, callback, options = {}) {
    if (element === window) {
      return DOM.on(window, "resize", () => {
        callback({
          content: { width: window.innerWidth, height: window.innerHeight }
        })
      })
    }

    var observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const sizes = {}
        if (entry.borderBoxSize)
          sizes.border = { width: entry.borderBoxSize.blockSize, height: entry.borderBoxSize.inlineSize }
        if (entry.contentBoxSize)
          sizes.content = { width: entry.contentBoxSize.blockSize, height: entry.contentBoxSize.inlineSize }

        callback(sizes)
      }
    })

    if (element === document)
      element = document.body

    options = Object.assign({}, options, { box: "border-box" })
    observer.observe(element, options)

    return {
      dispose: () => {
        if (observer)
          observer.disconnect()
        observer = null
      }
    }
  }
  static intersect (element, callback, options = {}) {
    options = Object.assign({}, options, { threshold: 0 })

    var observer = new IntersectionObserver(entries => {
      for (const entry of entries)
        callback(entry)
    }, options)

    observer.observe(element)

    return {
      dispose: () => {
        if (observer)
          observer.disonnect()
        observer = null
      }
    }
  }

  static ready (selector, callback, options = {}) {
    var observer = null
    var destroyed = false
    var context = options.context || document.body

    options.found = options.found || []
    const find = () => {
      for (const element of context.querySelectorAll(selector)) {
        if (!options.found.includes(element)) {
          options.found.push(element)
          callback(element)
        }
      }
    }

    const init = () => {
      Watch.log(`initializing "${selector}"`)
      find()

      if (!destroyed)
        observer = Watch.childAdditions(context || document.body, UTIL.throttle(100, find), {deep: true})
    }

    const disposable = {
      dispose: () => {
        if (observer)
          observer.dispose()

        observer = null
        destroyed = true
      }
    }

    // If context is still null, then document.body does not exist, we need to wait
    // for it to become ready. However, watching for child additions on the document
    // seems to fail, especially when another GM script is injected into the page.
    if (!context) {
      observer = UTIL.repeat(10, () => {
        if (context = document.body) {
          observer.dispose()
          init()
        }
      })
    } else {
      // Assure caller has a disposable before callback can be invoked
      UTIL.delay(1, init)
    }

    return disposable
  }
  static removed (element, callback, options = {}) {
    const parent = options.parent || document
    const isDetached = (child) => {
      if (child.parentNode === null)
        return true
      if (child.parentNode === parent)
        return false
      return isDetached(child.parentNode)
    }

    var disconnected = false
    const observer = new MutationObserver(() => {
      if (!disconnected && isDetached(element))
        callback(element)
    })

    observer.observe(parent, {
      childList: true,
      subtree: true
    })

    return {
      dispose: () => {
        if (!disconnected) {
          disconnected = true
          observer.diconnect()
          observer = null
        }
      }
    }
  }

  static log (...what) {
    if (Watch.debug)
      console.log(`[Watch]`, ...what)
  }
}

class Plugin {
  static register (options = null) {}

  get player () { return this.__player }

  constructor (player) {
    this.__player = player
  }
  destroy () {
    this.__player = null
    this.__info_resolver = null
  }

  update ({video_id}) {}

  async prependButton (template) {
    return this.__addButton("prepend", template)
  }
  async appendButton (template) {
    return this.__addButton("appendChild", template)
  }

  async addPopup (element) {
    return new Promise(resolve => {
      const observer = Watch.ready(".ytp-popup", container => {
          container.parentNode.appendChild(element)
          observer.dispose()

          resolve(element)
      }, {
        context: this.__player
      })
    })
  }

  async __addButton (method, template) {
    const button = document.createElement("button")

    button.setAttribute("draggable", "false")
    button.setAttribute("class", "ytp-button")
    button.setAttribute("style", "vertical-align: top;")
    button.innerHTML = template

    return new Promise(resolve => {
      const observer = Watch.ready(".ytp-right-controls", container => {
        container[method](button)
        observer.dispose()

        resolve(button)
      }, {
        context: this.__player
      })
    })
  }

  async getControl () {
    return this.__player.getPlayerPromise()
  }
  async getVideo () {
    return new Promise(resolve => {
      const observer = Watch.ready("video", video => {
          observer.dispose()
          resolve(video)
      }, {
        context: this.__player
      })
    })
  }

  log (...what) {
    if (this.debug)
      console.log(`[${this.constructor.name}]`, ...what)
  }
}

class Player {
  static get instance () {
    Player.debug = false
    return Player.__instance = (Player.__instance || new Player())
  }

  static get video_id () { return (new URL(window.location.href)).searchParams.get('v') }
  static get channel_id () { return (new URL(window.location.href)).pathname.match(/^\/channel\/([a-zA-Z0-9_]+)/) && RegExp.$1 }
  static get user_id () { return (new URL(window.location.href)).pathname.match(/^\/user\/([a-zA-Z0-9_]+)/) && RegExp.$1 }

  static get deferred_video_info () {
    const video_id = Player.video_id

    if (!video_id) {
      Player.__deferred_video_info = Promise.reject(new Error("Not a video page"))
    }
    else if (!Player.__deferred_video_info || Player.__deferred_video_info.__for !== video_id) {
      Player.__deferred_video_info = Promise.resolve().then(async () => {

        const response = await URL.GET(`https://www.youtube.com/get_video_info`, {query: {
            video_id,
            el: "detailpage"
          }})

        const info = [...new URLSearchParams(response).entries()].reduce(
          (acc, [k, v]) => ((acc[k] = v), acc),
          {}
        )

        return JSON.parse(info.player_response)
      }).then(data => {
        if (Player.debug)
          console.debug(`[Player]`, "player_response ready")
        return data
      })
      Player.__deferred_video_info.__for = video_id
    }

    return Player.__deferred_video_info
  }

  static async getInfo () {
    return Player.deferred_video_info
  }

  constructor () {
    this.__video_id = null
    this.__plugins = new Set()
    this.__players = new Map()
    this.__observers = [
      Watch.ready("ytd-player", this.__addPlayer.bind(this)),
      Watch.mutation(document.querySelector('head > title'), () => this.__updateInstances(), {
        subtree: true,
        characterData: true,
        childList: true
      })
    ]
  }
  destroy () {
    if (this.__observers)
      this.__observers.forEach(inst => inst.dispose())

    if (this.__players)
      this.__players.values().forEach(instances => instances.forEach(data => data.instance.destroy()))

    this.__observers = null
    this.__plugins = null
    this.__players = null
  }

  attach (plugin) {
    if (this.__plugins.has(plugin))
      return false

    this.__plugins.add(plugin)
    for (const player of this.__players.keys())
      this.__players.get(player).push(new plugin(player))

    return true
  }

  __addPlayer (player) {
    if (!this.__players.has(player)) {

      Player.log(`added player`, player)
      const removal = Watch.removed(player, () => {
        removal.dispose()
        this.__removePlayer(player)
      })

      const instances = []
      for (const plugin of this.__plugins) {
        Player.log(`creating instance of "${plugin.name}"`)

        try {
          instances.push({
            instance: new plugin(player),
            cache: null
          })
        } catch (error) {
          console.log(error)

          this.__plugins.delete(plugin)
        }
      }

      this.__players.set(player, instances)
      this.__updateInstances(true)
    }
  }
  __removePlayer (player) {
    if (this.__players.has(player)) {
      Player.log('destroying instances')

      this.__players.get(player).forEach(data => data.instance.destroy())
      this.__players.delete(player)
    }
  }
  __updateInstances (force = false) {
    const updateCache = (cache) => {
      for (const key in cache) {
        if (!this.__update_cache || this.__update_cache[key] !== cache[key])
          return this.__update_cache = cache
      }
      return force && cache
    }

    const cache = updateCache({
      video_id:   Player.video_id,
      channel_id: Player.channel_id,
      user_id:    Player.user_id
    })

    if (cache) {
      var count = 0

      for (const instances of this.__players.values()) {
        instances.forEach(data => {
          if (data.cache !== cache) {
            count++
            data.cache = cache
            data.instance.update(cache)
          }
        })
      }

      Player.log(`updated (${count}) instances`)
    }
  }

  static log (...what) {
    if (Player.debug)
      console.log("[Player]", ...what)
  }
}


class StyleControl extends Plugin {
  static get stylesheet () { return `
    ytd-watch-flexy:not([theater]):not([fullscreen]) #secondary-inner {
      position: fixed;
      width: 400px;
      top: 80px;
      bottom: 24px;
      overflow-y: scroll;
    }
    /* Display 5 thumbnails in a row */
    ytd-rich-item-renderer {
        width: 190px !important;
    }

    /* Remove the channels avatar icon */
    #avatar-link.ytd-rich-grid-video-renderer {
        display: none !important;
    }

    /* Hide channel-name, view-count, upload-date */
    ytd-video-meta-block, .ytd-video-meta-block[meta-block] {
        /* display: none !important; */
    }

    /* Make font smaller */
    ytd-rich-grid-video-renderer[mini-mode] #video-title.ytd-rich-grid-video-renderer {
        font-size: 1.2rem !important;
        line-height: 1.5rem !important;
        font-weight: 400 !important;
        max-height: 4.5rem !important;
    }
    ytd-video-meta-block[rich-meta] #channel-name.ytd-video-meta-block, ytd-video-meta-block[rich-meta] #metadata-line.ytd-video-meta-block {
        font-size: 1.0rem !important;
        font-weight: 400 !important;
        line-height: 1.5rem !important;
    }

    ytd-rich-section-renderer {
        display: none !important;
    }

    ytd-browse-secondary-contents-renderer {
        display: none !important;
    }

    /* Delete the stupid add above the thumbnails */
    ytd-video-masthead-ad-v3-renderer {
        display: none !important;
    }

    /* Pay for a movie? No thanks! */
    ytd-compact-movie-renderer, ytd-unlimited-offer-module-renderer, ytd-movie-offer-module-renderer {
      display: none !important;
    }

    .ytp-load-progress {
        background-color: rgba(0, 255, 0, .4) !important;
        background-image: none;
    }

    .style-scope.ytd-menu-popup-renderer {
        background-color: rgba(42, 42, 42, 0.9);
    }
  `}

  static register () {
    if (!StyleControl.__instance) {
      StyleControl.__instance = true
      GM_addStyle(StyleControl.stylesheet)
    }
  }
}

class VolumeControl extends Plugin {
  static get stylesheet () { return `
		.volume {
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
			align-items: center;
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			right: 0;
			opacity: 0;
			transition: opacity 500ms ease 0s;
			z-index: 10;
			pointer-events: none;
		}
		.volume > .track {
			width: 80%;
			max-width: 600px;
			margin-bottom: 10%;
      position: relative;
      border-radius: 5px;

      background-color: #444;
      border: 2px solid white;
		}
    .volume > .track:before {
      content: attr(data-label);
      font-size: 1.3em;
      font-weight: bold;
      position: absolute;
      text-align: center;
      top: 3px;
      left: 0;
      right: 0;
      color: #FFF;
    }
		.volume > .track > .bar {
			transition: width 100ms ease-out 0s;
			height: 20px;
      border-radius: 3px;

      background-color: #888;
		}
  `}

  static register (initial = null) {
    VolumeControl.__initial = initial
    Player.instance.attach(VolumeControl)
  }

  constructor (player) {
    super(player)

    this.debug = false
    this.__elements = this.__create()
    this.__delta = 0
    this.__delayed_hide = { dispose: () => {} }

    const child = player.appendChild(this.__elements.container)
    this.log(`added container:`, child)

    const ready = Watch.ready(".ytp-popup.ytp-settings-menu", (results) => {
      this.__settings_popup = results[0]
      ready.dispose()
    })

    this.__listener = DOM.on(player, "wheel", this.__adjust.bind(this))
  }
  destroy () {
    if (this.__elements)
      this.__elements.container.parentNode.removeChild(this.__elements.container)

    if (this.__listener)
      this.__listener.dispose()

    if (this.__delayed_hide)
      this.__delayed_hide.dispose()

    this.__listener = null
    this.__delayed_hide = null
    this.__elements = null

    super.destroy()
  }
  update ({video_id}) {
    if (video_id && VolumeControl.__initial !== null) {
      this.getControl().then(control => {
        this.log(`Resetting volume to (${VolumeControl.__initial})`)
        if (VolumeControl.__initial > 0) {
          control.unMute()
          control.setVolume(VolumeControl.__initial)
        }
      })
    }
  }

  __adjust (event) {
    if (event.deltaX)
      return

    this.__delta += event.deltaY > 0 ? -1 : 1

    if (!this.__once) {
      this.__once = this.getControl()
        .then(control => {
          if (!this.__elements)
            return

          // disable when any of the popups are open
          if (this.__settings_popup && this.__settings_popup.offsetParent != null)
            return

          const volume = Math.max(Math.min(control.getVolume() + this.__delta, 100), 0)

          if (volume > 0 && control.isMuted())
            control.unMute()

          control.setVolume(volume)

          this.__elements.control.style.opacity = 1
          this.__elements.bar.style.width = volume + '%'
          this.__elements.track.dataset.label = volume + '%'

          this.__delayed_hide.dispose()
          this.__delayed_hide = UTIL.delay(800, () => {
            if (this.__elements)
              this.__elements.control.style.opacity = 0
          })
        })
        .then(() => {
          this.__once = null
          this.__delta = 0
        })
    }

    event.preventDefault()
    event.stopImmediatePropagation()
  }
  __create () {
    const bar = document.createElement("div")
    bar.setAttribute("class", "bar")

    const track = document.createElement("div")
    track.setAttribute("class", "track")
    track.appendChild(bar)

    const control = document.createElement("div")
    control.setAttribute("class", "volume")
    control.appendChild(track)

    const style = document.createElement("style")
    style.type = "text/css"
    style.appendChild(document.createTextNode(VolumeControl.stylesheet))

    const container = document.createElement("div")

    this.__shadow = container.attachShadow({mode: "closed"})
    this.__shadow.appendChild(style)
    this.__shadow.appendChild(control)

    return {
      container,
      control,
      track,
      bar
    }
  }
}

class LoudnessControl extends Plugin {
  static register () {
    Player.instance.attach(LoudnessControl)
  }

  constructor (player) {
    super(player)

    this.debug = true
  }
  destroy () {
    this.__factory = null

    super.destroy()
  }

  async update ({video_id}) {
    if (!video_id)
      return

    const info = await Player.getInfo()
    const node = await this.__createGainNode()

    const loudness = info.playerConfig.audioConfig.loudnessDb

    var adjust = 1
    if (loudness < 0)
      adjust = 10 ** ((loudness * -1) / 20)

    this.log(`boosting volume by ${adjust.toFixed(2) * 100}%`)
    node.gain.value = adjust
  }

  async __createGainNode () {
    return this.__factory = this.__factory || (this.getVideo().then(video => {
      const context = new AudioContext()
      const source  = context.createMediaElementSource(video)
      const node    = context.createGain()

      node.gain.value = 1
      source.connect(node)
      node.connect(context.destination)

      return node
    }))
  }
}

// with cipher https://www.youtube.com/watch?v=obt6HZh__CE
class DownloadControl extends Plugin {
  static get icon () { return `
    <svg style="display: block; margin: auto;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20px" height="20px" viewBox="0 0 24 24" version="1.1">
      <g id="surface1">
        <path fill="#FFF" d="M 17.933594 10.941406 C 17.8125 10.671875 17.542969 10.5 17.25 10.5 L 14.25 10.5 L 14.25 0.75 C 14.25 0.335938 13.914062 0 13.5 0 L 10.5 0 C 10.085938 0 9.75 0.335938 9.75 0.75 L 9.75 10.5 L 6.75 10.5 C 6.457031 10.5 6.1875 10.671875 6.066406 10.941406 C 5.945312 11.207031 5.992188 11.523438 6.1875 11.742188 L 11.4375 17.742188 C 11.578125 17.90625 11.785156 18 12 18 C 12.214844 18 12.421875 17.90625 12.5625 17.742188 L 17.8125 11.742188 C 18.007812 11.523438 18.054688 11.207031 17.933594 10.941406 Z M 17.933594 10.941406 "/>
        <path fill="#FFF" d="M 20.25 16.5 L 20.25 21 L 3.75 21 L 3.75 16.5 L 0.75 16.5 L 0.75 22.5 C 0.75 23.328125 1.421875 24 2.25 24 L 21.75 24 C 22.578125 24 23.25 23.328125 23.25 22.5 L 23.25 16.5 Z M 20.25 16.5 "/>
      </g>
    </svg>
  `}
  static get stylesheet () { return `
    .ytp-popup.download-links {
      z-index: 71;
      right: 22px;
      bottom: 49px;
      overflow: hidden;
      font-size: 1.3em;
      padding: 12px;
      cursor: pointer;
      display: none;
    }

    .ytp-popup.download-links > .table-container {
      overflow-y: auto;
      max-height: 177px;
      width: calc(100% + 50px);
    }
    .ytp-popup.download-links tr > td:not(:last-child) {
      padding-right: 8px;
    }
    .ytp-popup.download-links tr.audio-video {
      color: green;
    }
    .ytp-popup.download-links tr.video {
      color: red;
    }
    .ytp-popup.download-links tr.audio {
      color: aqua;
    }
  `}

  static register () {
    if (window.self !== window.top) {
      const url = new URL(window.location.href)

      if (url.searchParams.has("twifty-download-id")) {
        const video = document.getElementsByTagName("video")[0]
        if (video)
          video.pause()

        const a = document.createElement('a')
        a.href = url
        a.download = url.searchParams.get("twifty-download-name")
        a.click()

        // A delay is required to give browser enough time to open popup
        window.setTimeout(() => {
          window.top.postMessage({
            "twifty-download": url.searchParams.get("twifty-download-id")
          }, "*")
        }, 5000)
      }
    } else if (Player.instance.attach(DownloadControl)) {
      const style = document.createElement("style")
      style.type = "text/css"
      style.appendChild(document.createTextNode(DownloadControl.stylesheet))

      document.head.appendChild(style)
    }
  }

  static genID () {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    )
  }

  static async fetchSigDecoder (url, log) {
    if (DownloadControl.__decoders && DownloadControl.__decoders[url])
      return DownloadControl.__decoders[url]

    function buildDecoder (data) {
      const actionExpr = /(\w+)(?:\.(\w+)|\[(?:("|'|\`)((?:\\\3|[^\3])*?)\3)\])\(a,(\d+)\)/
      const actionsFuncExp = new RegExp(
        String.raw`function(?: \w+)?\(a\)\{` +
        String.raw`a=a\.split\((?:''|"")\);\s*` +
        String.raw`((?:(?:a=)?\w+(?:\.\w+|\[(?:("|'|\`)(?:\\\2|[^\2])*?\2)\])\(a,\d+\);)+)` +
        String.raw`return a\.join\((?:''|""|\`\`)\)` +
        String.raw`\}`
      )

      const actions = data.match(actionsFuncExp) && RegExp.$1
      if (!actions) {
        log("Failed to find sig function")
        return
      }

      const obj_cache = {}
      const obj_actions = []

      // a=a.split("");Mt.oG(a,35);Mt.nB(a,25);Mt.oG(a,42);Mt.oG(a,11);Mt.oG(a,48);Mt.Fu(a,3);Mt.oG(a,70);Mt.Fu(a,1);return a.join("")
      for (const action of actions.split(';').filter(a => a)) {
        // Each action should be a method call
        if (!action.match(actionExpr)) {
          log(`Failed to parse action "${action}"`)
          return
        }

        const obj_name = RegExp.$1
        const obj_func = RegExp.$2 || RegExp.$4
        const obj_arg  = RegExp.$5

        if (!(obj_name in obj_cache)) {
          if (!data.match(new RegExp(String.raw`var ${obj_name}=({.+?});`))) {
            log(`Failed to find object "${obj_name}"`)
            return
          }

          try {
            obj_cache[ obj_name ] = eval(`(${RegExp.$1})`)
          } catch (error) {
            log(`Failed to evaluate object "${RegExp.$1}"`)
            return
          }
        }

        if (!(obj_func in obj_cache[obj_name])) {
          log(`Function "${obj_func}" not found in object`)
          return
        }

        obj_actions.push(a => obj_cache[obj_name][obj_func](a, obj_arg))
      }

      return function (sig) {
        sig = sig.split('')

        obj_actions.forEach(action => action(sig))

        return sig.join('')
      }
    }

    const data = await URL.GET(url)
    const decoder = buildDecoder(data.replace(/\r?\n/g, ''))

    if (!decoder)
      throw new Error("Failed to build sig decoder")

    DownloadControl.__decoders = DownloadControl.__decoders || {}
    return DownloadControl.__decoders[url] = decoder
  }

  static async fetchFromYTDown () {
    return URL.GET("https://ytdown.cc/")
      .then(data => {
        const match = data.match(/\'appSecretToken\'\s*:\s*\'([a-z0-9]+)\'/)

        if (match) {
          const loc = new URL(window.location.href)
          const id = loc.searchParams.get('v')
          const query = {
            vidID: id,
            format: "video",
            streams: "mergedstreams",
            appSecretToken: match[1]
          }
          const headers = {
            Referer: `https://ytdown.cc/youtube/${id}`
          }

          return URL.GET("https://ytdown.cc/@grab", { query, headers })
        }

        throw new Error("Failed to find token")
      })
      .then(data => {
        const container = document.createElement("div")
        container.innerHTML = data

        const rows = container.getElementsByTagName("tr")
        const formats = []

        for (const row of rows) {
          const cols = row.getElementsByTagName("td")
          if (cols.length === 4) {
            formats.push({
              audio: true,
              video: true,
              type: cols[0].textContent.trim().toUpperCase(),
              resolution: cols[1].textContent.trim(),
              size: cols[2].textContent.trim(),
              url: cols[3].firstElementChild.href
            })
          }
        }

        return formats
      })
  }
  static async fetchFromLocal (data, log) {
    return Promise.resolve().then(async () => {
      const formats = []
      const workers = []

      const sizes = [ "KB", "MB", "GB" ]
      const speeds = [ "Kbps", "Mbps", "Gbps" ]

      function calc (size, labels) {
        for (var idx = 0; idx < labels.length; ++idx) {
          size /= 1000;

          if (size < 10)
            return Math.round(size * 100) / 100 + labels[idx]

          if (size < 100)
            return Math.round(size * 10) / 10 + labels[idx]

          if (size < 1000 || idx == labels.length - 1)
            return Math.round(size) + labels[idx]
        }
      }
      function getSize (size) { return calc(+size, sizes) }
      function getSpeed (freq) { return calc(+freq, speeds) }
      function getType (mimeType) {
        const mimes = {
          "video/3gpp":       "3GP",
          "video/x-flv":      "FLV",
          "video/x-m4v":      "M4V",
          "audio/mpeg":       "MP3",
          "video/mp4":        "MP4",
          "audio/mp4":        "M4A",
          "video/quicktime":  "QT",
          "audio/webm":       "WEBM",
          "video/webm":       "WEBM",
          "video/ms-wmv":     "WMV"
        }
        const codecs = {
          "av01":   "AV1",
          "opus":   "OPUS",
          "vorbis": "VOR",
          "vp9":    "VP9"
        }

        const codec = mimeType.match(/codecs=\"(.+?)\"/) ? RegExp.$1 : ''
        if (!codec.includes(',') && mimeType.startsWith("video/mp4") && !codec.startsWith("av01"))
          return "M4V"

        for (const name in codecs) {
          if (codec.startsWith(name))
            return codecs[ codec ]
        }

        for (const label in mimes) {
          if (mimeType.startsWith(label))
            return mimes[ label ]
        }

        return "---"
      }
      function comparator (l, r) {
        const l_weight = (l.audio ? 1 : 0) + (l.video ? 2 : 0)
        const r_weight = (r.audio ? 1 : 0) + (r.video ? 2 : 0)

        if (l_weight > r_weight) return -1
        if (r_weight > l_weight) return 1

        const l_res = parseInt(l.resolution)
        const r_res = parseInt(r.resolution)

        if (l_res > r_res) return -1
        if (r_res > l_res) return 1

        return 0
      }

      async function parse (raw) {
        const format = {
          url:        raw.url,
          detail:     raw.mimeType,
          resolution: raw.qualityLabel,
          audio:      !!raw.audioQuality,
          video:      !!raw.qualityLabel,
          type:       getType(raw.mimeType)
        }

        // There exists a raw.contentLength, but the URL may be a fragment which
        // results in a 404 error when fetching
        try {
          // URL needs decoding, but we need to decode any sig
          const headers = await URL.HEAD(raw.url)
          format.size = headers["content-length"] ? getSize(headers["content-length"]) : 0
        } catch (error) {
          // log(raw)
          if (!error.response)
            throw error

          log(`Failed to download url "${error.response.status} ${error.response.statusText}"`)

          // Discard as it will only result in a dead link
          return
        }

        if (!format.video)
          format.resolution = getSpeed(raw.bitrate)

        formats.push(format)
      }

      // Additional streams may be found in the manifests
      // const has_manifest = data.streamingData.dashManifestUrl || data.streamingData.hlsManifestUrl
      const raw_formats = [...(data.streamingData.formats || []), ...(data.streamingData.adaptiveFormats || [])]
      const sigDecode = await DownloadControl.fetchSigDecoder(ytcfg.get('PLAYER_JS_URL'), log)

      for (const raw of raw_formats) {
        if (raw.cipher) {
          Object.assign(raw, URL.parseQueryString(raw.cipher))
          delete raw.cipher
        }

        const sig = raw.s ? sigDecode(raw.s) : null
        const url = new URL(window.decodeURIComponent(raw.url))

        url.searchParams.set("ratebypass", "yes")
        if (sig)
          url.searchParams.set(raw.sp || "signature", sig)

        raw.url = url.toString()

        workers.push(parse(raw))
      }

      await Promise.all(workers)

      log(`Parsed (${formats.length}) formats`)

      return formats.sort(comparator)
    })
  }

  constructor (player) {
    super(player)

    this.debug = false
    this.__create()
  }
  destroy () {
    if (this.__listeners)
      this.__listeners.forEach(listener => listener.dispose())

    if (this.__observer)
      this.__observer.dispose()

    this.__create = null
    this.__observer = null
    this.__resolver = null
    this.__listeners = null
    this.__elements = null

    super.destroy()
  }

  update ({video_id}) {
    const deferred = Player.deferred_video_info

    if (this.__pre_download && this.__pre_download.__for === deferred) {
      this.log(`__pre_download already available for "${video_id}"`)
      return
    }

    this.log(`creating pre-download promise for "${video_id}"`)

    this.__pre_download = new Promise((resolve, reject) => {
      deferred.then(async info => {
        const formats = await DownloadControl.fetchFromLocal(info, this.log.bind(this))

        this.log(`found ${formats.length} formats`, formats)

        if (formats.length)
          this.__elements.button.disabled = false

        resolve({
          title: info.videoDetails.title,
          formats
        })
      }, error => {
        this.log(`pre-download failed with "${error.message}"`)
        reject()
      })
    })
    this.__pre_download.__for = deferred

    this.__pre_download.catch(() => {})
  }

  async __create () {
    const popup = document.createElement("div")
    popup.setAttribute("class", "ytp-popup download-links")

    const scroll = document.createElement("div")
    scroll.setAttribute("class", "table-container")
    popup.appendChild(scroll)

    const table = document.createElement("table")
    scroll.appendChild(table)

    const [ button ] = await Promise.all([
      this.prependButton(DownloadControl.icon),
      this.addPopup(popup)
    ])

    const outer = document.createElement("span")

    button.disabled = true
    button.appendChild(outer)

    this.__listeners = [
      DOM.on(button, "click", e => {
        if (e.ctrlKey)
          this.__popup()
        else
          this.__download()
      }),
      DOM.on(popup, "wheel",  e => e.stopPropagation())
    ]

    return this.__elements = {
      popup,
      table,
      button,
    }
  }
  async __popup () {
    if (this.__visible)
      return

    this.__visible = true

    try {
      await this.__populate()
    } catch (_) {
      this.__visible = false
      return
    }

    const disposables = []
    const closePopup = () => {
      this.__elements.popup.style.display = "none"
      disposables.forEach(disposable => disposable.dispose())
      this.__visible = false
    }

    disposables.push(UTIL.repeat(2000, () => {
      if (document.activeElement !== this.__elements.button)
        closePopup()
    }))

    disposables.push(DOM.on(this.__elements.button, "blur", e => {
      if (this.__elements.popup.querySelector(":hover"))
        this.__elements.button.focus()
      else
        closePopup()
    }))

    this.__elements.popup.style.display = "block"
  }
  async __populate () {
    const {title, formats} = await this.__pre_download

    this.__elements.table.innerHTML = ""

    for (const format of formats) {
      const row = document.createElement("tr")

      if (format.video && format.audio)
        row.setAttribute("class", "audio-video")
      else if (format.video)
        row.setAttribute("class", "video")
      else
        row.setAttribute("class", "audio")

      const cols = [
        `<td>${format.type}</td>`,
        `<td>${format.resolution}</td>`,
        `<td>${format.size}</td>`,
      ]

      row.innerHTML = cols.join('')
      row.addEventListener("click", this.__saveAs(format.url, `${title}.${format.type}`))

      this.__elements.table.appendChild(row)
    }
  }
  async __download () {
    const {title, formats} = await this.__pre_download

    if (formats.length)
      this.__saveAs(formats[0].url, `${title}.${formats[0].type}`)()
    else
      this.log("No formats exist")
  }
  __saveAs (url, name) {
    return function action () {
      const id = DownloadControl.genID()

      url += '&' + URL.buildQueryString(null, {
        "twifty-download-name": name,
        "twifty-download-id": id
      })

      const frame = document.createElement("iframe")

      const disposables = [
        { dispose: () => document.body.removeChild(frame) },
        DOM.delay(10000, () => {
          disposables.forEach(disposable => disposable.dispose())
        }),
        DOM.on(window, "message", event => {
          if ("twifty-download" in event.data && event.data["twifty-download"] === id)
            disposables.forEach(disposable => disposable.dispose())
        })
      ]

      frame.setAttribute("id", id)
      frame.setAttribute("style", "display: none;")
      frame.setAttribute("src", url)

      document.body.appendChild(frame)
    }
  }
}

class CaptureControl extends Plugin {
  static get icon () { return `
    <svg style="display: block; margin: auto;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20px" height="20px" viewBox="0 0 24 24" version="1.1">
      <g id="surface1">
        <path fill="#FFF" d="M 6.246094 18.523438 C 4.648438 18.523438 3.222656 17.5 2.707031 15.972656 L 2.671875 15.859375 C 2.550781 15.453125 2.5 15.113281 2.5 14.773438 L 2.5 7.960938 L 0.0742188 16.054688 C -0.238281 17.246094 0.472656 18.480469 1.664062 18.808594 L 17.121094 22.949219 C 17.316406 23 17.507812 23.023438 17.699219 23.023438 C 18.695312 23.023438 19.601562 22.363281 19.859375 21.386719 L 20.757812 18.523438 Z M 6.246094 18.523438 "/>
        <path fill="#FFF" d="M 8.996094 8.027344 C 10.097656 8.027344 10.996094 7.132812 10.996094 6.027344 C 10.996094 4.925781 10.097656 4.027344 8.996094 4.027344 C 7.894531 4.027344 6.996094 4.925781 6.996094 6.027344 C 6.996094 7.132812 7.894531 8.027344 8.996094 8.027344 Z M 8.996094 8.027344 "/>
        <path fill="#FFF" d="M 21.492188 1.03125 L 6.496094 1.03125 C 5.121094 1.03125 3.996094 2.152344 3.996094 3.53125 L 3.996094 14.523438 C 3.996094 15.902344 5.121094 17.023438 6.496094 17.023438 L 21.492188 17.023438 C 22.867188 17.023438 23.992188 15.902344 23.992188 14.523438 L 23.992188 3.53125 C 23.992188 2.152344 22.867188 1.03125 21.492188 1.03125 Z M 6.496094 3.03125 L 21.492188 3.03125 C 21.765625 3.03125 21.992188 3.253906 21.992188 3.53125 L 21.992188 10.625 L 18.832031 6.941406 C 18.5 6.546875 18.015625 6.339844 17.492188 6.328125 C 16.976562 6.328125 16.488281 6.558594 16.15625 6.957031 L 12.445312 11.414062 L 11.234375 10.207031 C 10.550781 9.523438 9.4375 9.523438 8.757812 10.207031 L 5.996094 12.964844 L 5.996094 3.53125 C 5.996094 3.253906 6.222656 3.03125 6.496094 3.03125 Z M 6.496094 3.03125 "/>
      </g>
    </svg>
  `}

  static register () {
    Player.instance.attach(CaptureControl)
  }

  constructor (player) {
    super(player)

    this.__create()
  }
  destroy () {
    if (this.__elements)
      this.__elements.button.parentNode.removeChild(this.__elements.button)

    this.__elements = null

    super.destroy()
  }

  async __create () {
    return this.prependButton(CaptureControl.icon).then(button => {
      button.setAttribute("title", "Capture Frame")

      this.__click_handler = DOM.on(button, "click", () => this.__capture())
      return this.__elements = {
        button
      }
    })
  }
  async __capture () {
    function timestamp (seconds) {
      const fraction = ((seconds + ".0").split(".")[1] + "000").substring(0, 3)

      seconds = Math.floor(seconds)
      const days = Math.floor(seconds / (3600 * 24))
      seconds -= days * 3600 * 24
      const hours = Math.floor(seconds / 3600)
      seconds -= hours * 3600
      const minutes = Math.floor(seconds / 60)
      seconds -= minutes * 60

      var result = days ? days + ':' : ''
      if (hours) result += hours + ':'
      if (minutes) result += minutes + ':'
      result += seconds + '.' + fraction

      return result
    }

    const player = await this.getControl()
    const video = await this.getVideo()
    const info = await Player.getInfo()

    const title = player.getVideoData().title
    const seconds = player.getCurrentTime()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    const saveBlob = (blob) => {
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `${title}[${timestamp(seconds)}].png`
      a.click()
      URL.revokeObjectURL(a.href)
    }

    if (seconds == 0) {
      const thumbnail = info.videoDetails.thumbnail.thumbnails.reduce((acc, curr) => curr.height > acc.height ? curr : acc, { height: 0 })

      const blob = await URL.BLOB(thumbnail.url)
      const image = document.createElement("img")

      image.src = URL.createObjectURL(blob)
      canvas.width = thumbnail.width
      canvas.height = thumbnail.height
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(saveBlob, "image/png", 1)
      }
    } else {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(saveBlob, "image/png", 1)
    }
  }
}

class MutateControl extends Plugin {
  static get root_icon () { return `
    <div>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20px" height="20px" viewBox="0 0 24 24" version="1.1">
        <g id="surface1">
          <path fill="#FFF" d="M 23.964844 11.082031 C 23.753906 8.296875 22.582031 5.742188 20.742188 3.78125 C 20.609375 3.640625 20.386719 3.632812 20.246094 3.769531 C 20.105469 3.902344 20.097656 4.125 20.230469 4.265625 C 20.386719 4.433594 20.539062 4.601562 20.675781 4.769531 C 20.679688 4.773438 20.683594 4.777344 20.691406 4.785156 C 21.753906 6.066406 22.539062 7.578125 22.957031 9.242188 C 22.351562 8.488281 21.492188 7.800781 20.402344 7.207031 C 19.632812 6.785156 18.773438 6.429688 17.851562 6.144531 C 17.28125 4.292969 16.273438 2.261719 14.753906 1.042969 C 15.148438 1.140625 15.558594 1.265625 15.941406 1.410156 C 16.972656 1.789062 18.058594 2.382812 19.042969 3.167969 C 19.195312 3.289062 19.417969 3.265625 19.539062 3.113281 C 19.660156 2.960938 19.632812 2.742188 19.480469 2.621094 C 19.398438 2.554688 19.300781 2.476562 19.261719 2.449219 C 19.082031 2.3125 18.859375 2.152344 18.824219 2.132812 L 18.828125 2.132812 C 17.59375 1.277344 16.203125 0.65625 14.738281 0.316406 C 14.738281 0.3125 14.734375 0.3125 14.730469 0.3125 C 14.726562 0.3125 14.722656 0.3125 14.71875 0.308594 C 14.613281 0.285156 14.5 0.261719 14.375 0.234375 C 14.371094 0.234375 14.371094 0.234375 14.367188 0.234375 L 14.34375 0.230469 C 14.242188 0.210938 14.136719 0.191406 14.027344 0.171875 C 14.023438 0.171875 14.023438 0.171875 14.019531 0.171875 L 13.984375 0.164062 C 13.875 0.148438 13.765625 0.128906 13.65625 0.113281 L 13.648438 0.113281 C 13.644531 0.113281 13.636719 0.113281 13.632812 0.113281 C 13.621094 0.109375 13.609375 0.109375 13.597656 0.105469 L 13.5625 0.101562 C 13.558594 0.101562 13.554688 0.101562 13.550781 0.101562 C 13.4375 0.0859375 13.324219 0.0703125 13.210938 0.0625 C 13.210938 0.0625 13.210938 0.0625 13.207031 0.0625 C 13.207031 0.0585938 13.207031 0.0585938 13.203125 0.0585938 C 13.191406 0.0585938 13.179688 0.0585938 13.167969 0.0585938 C 13.160156 0.0546875 13.152344 0.0546875 13.144531 0.0546875 C 13.144531 0.0546875 13.140625 0.0546875 13.136719 0.0546875 L 13.125 0.0546875 C 13.035156 0.0429688 12.941406 0.0390625 12.851562 0.03125 C 12.847656 0.03125 12.84375 0.03125 12.839844 0.03125 C 10.378906 -0.144531 7.839844 0.4375 5.601562 1.847656 C -1.25 6.207031 -1.910156 15.828125 4.144531 21.074219 C 8.65625 24.980469 15.351562 24.972656 19.851562 21.074219 C 22.769531 18.546875 24.253906 14.824219 23.964844 11.082031 Z M 17.039062 5.914062 C 15.480469 5.515625 13.769531 5.304688 12 5.304688 C 10.230469 5.304688 8.515625 5.515625 6.957031 5.914062 C 9.332031 -0.984375 14.640625 -1.070312 17.039062 5.914062 Z M 6.4375 2.164062 C 7.246094 1.703125 8.207031 1.304688 9.242188 1.042969 C 7.722656 2.261719 6.71875 4.292969 6.144531 6.144531 C 4.292969 6.71875 2.257812 7.726562 1.042969 9.242188 C 1.808594 6.195312 3.800781 3.664062 6.4375 2.164062 Z M 5.914062 6.960938 C 5.515625 8.519531 5.304688 10.230469 5.304688 12 C 5.304688 13.765625 5.515625 15.476562 5.914062 17.035156 C -0.964844 14.667969 -1.101562 9.371094 5.914062 6.960938 Z M 1.039062 14.75 C 1.578125 15.425781 2.320312 16.046875 3.246094 16.59375 C 4.097656 17.097656 5.074219 17.519531 6.144531 17.851562 C 6.71875 19.710938 7.722656 21.730469 9.230469 22.945312 C 5.265625 21.925781 2.054688 18.78125 1.039062 14.75 Z M 6.957031 18.082031 C 8.203125 18.402344 9.546875 18.601562 10.941406 18.667969 C 11.132812 18.675781 11.296875 18.527344 11.308594 18.335938 C 11.316406 18.140625 11.167969 17.976562 10.972656 17.964844 C 9.441406 17.890625 8 17.652344 6.707031 17.285156 C 6.25 15.675781 6.007812 13.871094 6.007812 12 C 6.007812 10.125 6.25 8.320312 6.710938 6.710938 C 8.320312 6.253906 10.125 6.007812 12 6.007812 C 13.875 6.007812 15.675781 6.253906 17.289062 6.710938 C 18.222656 10 18.226562 13.996094 17.289062 17.289062 C 15.847656 17.699219 14.25 17.9375 12.585938 17.984375 C 12.394531 17.988281 12.242188 18.148438 12.246094 18.34375 C 12.25 18.535156 12.40625 18.6875 12.597656 18.6875 C 12.601562 18.6875 12.605469 18.6875 12.605469 18.6875 C 14.160156 18.644531 15.660156 18.4375 17.039062 18.082031 C 14.675781 24.96875 9.363281 25.089844 6.957031 18.082031 Z M 14.769531 22.945312 C 16.277344 21.730469 17.28125 19.707031 17.855469 17.851562 C 18.859375 17.542969 19.785156 17.148438 20.605469 16.683594 C 21.597656 16.113281 22.390625 15.460938 22.957031 14.75 C 21.941406 18.785156 18.730469 21.929688 14.769531 22.945312 Z M 20.257812 16.070312 C 19.601562 16.445312 18.871094 16.769531 18.082031 17.039062 C 18.894531 13.863281 18.898438 10.136719 18.082031 6.960938 C 23.910156 8.964844 25.160156 13.269531 20.257812 16.070312 Z M 20.257812 16.070312 "/>
          <path fill="#FFF" d="M 9.472656 11.996094 C 9.660156 11.847656 9.765625 11.574219 9.765625 11.242188 C 9.765625 10.660156 9.421875 10.351562 8.773438 10.351562 C 7.957031 10.351562 7.738281 10.886719 7.738281 11.199219 C 7.738281 11.421875 7.816406 11.496094 8.0625 11.496094 C 8.308594 11.496094 8.363281 11.347656 8.363281 11.226562 C 8.363281 11.023438 8.5 10.921875 8.769531 10.921875 C 9.039062 10.921875 9.15625 11.042969 9.15625 11.324219 C 9.15625 11.6875 9.007812 11.757812 8.75 11.757812 C 8.449219 11.757812 8.441406 12.289062 8.75 12.289062 C 9.085938 12.289062 9.238281 12.425781 9.238281 12.71875 C 9.238281 13.054688 9.203125 13.304688 8.753906 13.304688 C 8.40625 13.304688 8.285156 13.125 8.285156 12.972656 C 8.285156 12.75 8.121094 12.722656 7.960938 12.722656 C 7.75 12.722656 7.667969 12.800781 7.667969 12.996094 C 7.667969 13.433594 8.039062 13.875 8.75 13.875 C 9.460938 13.875 9.867188 13.484375 9.867188 12.804688 L 9.867188 12.71875 C 9.867188 12.386719 9.730469 12.140625 9.472656 11.996094 Z M 9.472656 11.996094 "/>
          <path fill="#FFF" d="M 11.316406 11.691406 C 11.082031 11.691406 10.890625 11.75 10.742188 11.859375 C 10.742188 11.382812 10.671875 10.925781 11.230469 10.925781 C 11.457031 10.925781 11.699219 11.03125 11.699219 11.261719 C 11.699219 11.359375 11.742188 11.515625 12.019531 11.515625 C 12.09375 11.515625 12.320312 11.515625 12.320312 11.242188 C 12.320312 10.800781 11.949219 10.351562 11.242188 10.351562 C 10.519531 10.351562 10.121094 10.742188 10.121094 11.445312 L 10.121094 12.78125 C 10.121094 13.488281 10.511719 13.875 11.222656 13.875 C 11.929688 13.875 12.320312 13.488281 12.320312 12.78125 L 12.320312 12.699219 C 12.320312 12.039062 11.972656 11.691406 11.316406 11.691406 Z M 11.222656 13.332031 C 10.898438 13.332031 10.742188 13.160156 10.742188 12.808594 L 10.742188 12.691406 C 10.742188 12.371094 10.894531 12.222656 11.21875 12.222656 C 11.546875 12.222656 11.695312 12.378906 11.695312 12.730469 C 11.695312 13.085938 11.617188 13.332031 11.222656 13.332031 Z M 11.222656 13.332031 "/>
          <path fill="#FFF" d="M 13.6875 10.351562 C 12.976562 10.351562 12.589844 10.742188 12.589844 11.445312 L 12.589844 12.78125 C 12.589844 13.488281 12.976562 13.875 13.6875 13.875 C 14.386719 13.875 14.789062 13.476562 14.789062 12.78125 L 14.789062 11.445312 C 14.789062 10.753906 14.386719 10.351562 13.6875 10.351562 Z M 14.160156 12.78125 C 14.160156 13.128906 14.003906 13.304688 13.6875 13.304688 C 13.371094 13.304688 13.214844 13.132812 13.214844 12.78125 L 13.214844 11.445312 C 13.214844 11.097656 13.371094 10.925781 13.6875 10.925781 C 14.003906 10.925781 14.160156 11.101562 14.160156 11.445312 Z M 14.160156 12.78125 "/>
          <path fill="#FFF" d="M 15.699219 9.886719 C 15.355469 9.886719 15.066406 10.15625 15.066406 10.476562 L 15.066406 10.648438 C 15.066406 10.964844 15.363281 11.242188 15.699219 11.242188 C 16.035156 11.242188 16.332031 10.964844 16.332031 10.648438 L 16.332031 10.476562 C 16.332031 10.15625 16.042969 9.886719 15.699219 9.886719 Z M 15.808594 10.648438 C 15.808594 10.710938 15.753906 10.769531 15.699219 10.769531 C 15.640625 10.769531 15.589844 10.710938 15.589844 10.648438 L 15.589844 10.476562 C 15.589844 10.421875 15.636719 10.363281 15.699219 10.363281 C 15.761719 10.363281 15.808594 10.421875 15.808594 10.476562 Z M 15.808594 10.648438 "/>
        </g>
      </svg>
    </div>
  `}
  static get rotate_icon () { return `
    <div>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20px" height="20px" viewBox="0 0 24 24" version="1.1">
        <g id="surface1">
          <path fill="#FFF" d="M 22.097656 12.679688 C 21.882812 10.914062 21.179688 9.21875 20.039062 7.746094 L 18.242188 9.539062 C 18.921875 10.496094 19.351562 11.570312 19.539062 12.679688 Z M 22.097656 12.679688 "/>
          <path fill="#FFF" d="M 16.546875 5.769531 L 10.777344 0 L 10.777344 3.890625 C 5.773438 4.511719 1.902344 8.773438 1.902344 13.945312 C 1.902344 19.117188 5.773438 23.378906 10.777344 24 L 10.777344 21.4375 C 7.183594 20.835938 4.4375 17.710938 4.4375 13.945312 C 4.4375 10.179688 7.183594 7.054688 10.777344 6.453125 L 10.777344 11.410156 Z M 16.546875 5.769531 "/>
          <path fill="#FFF" d="M 13.3125 21.433594 L 13.3125 24 C 15.074219 23.785156 16.785156 23.101562 18.257812 21.957031 L 16.4375 20.140625 C 15.488281 20.8125 14.421875 21.242188 13.3125 21.433594 Z M 13.3125 21.433594 "/>
          <path fill="#FFF" d="M 18.242188 18.351562 L 20.039062 20.144531 C 21.179688 18.675781 21.882812 16.976562 22.097656 15.214844 L 19.539062 15.214844 C 19.351562 16.324219 18.921875 17.394531 18.242188 18.351562 Z M 18.242188 18.351562 "/>
        </g>
      </svg>
    </div>
  `}
  static get flip_icon () { return `
    <div>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20px" height="20px" viewBox="0 0 24 24" version="1.1">
        <g id="surface1">
          <path fill="#FFF" d="M 12 0 C 11.613281 0 11.296875 0.316406 11.296875 0.703125 L 11.296875 3.984375 C 11.296875 4.371094 11.613281 4.6875 12 4.6875 C 12.386719 4.6875 12.703125 4.371094 12.703125 3.984375 L 12.703125 0.703125 C 12.703125 0.316406 12.386719 0 12 0 Z M 12 0 "/>
          <path fill="#FFF" d="M 12 6.421875 C 11.613281 6.421875 11.296875 6.738281 11.296875 7.125 L 11.296875 10.40625 C 11.296875 10.792969 11.613281 11.109375 12 11.109375 C 12.386719 11.109375 12.703125 10.792969 12.703125 10.40625 L 12.703125 7.125 C 12.703125 6.738281 12.386719 6.421875 12 6.421875 Z M 12 6.421875 "/>
          <path fill="#FFF" d="M 12 12.890625 C 11.613281 12.890625 11.296875 13.207031 11.296875 13.59375 L 11.296875 16.875 C 11.296875 17.261719 11.613281 17.578125 12 17.578125 C 12.386719 17.578125 12.703125 17.261719 12.703125 16.875 L 12.703125 13.59375 C 12.703125 13.207031 12.386719 12.890625 12 12.890625 Z M 12 12.890625 "/>
          <path fill="#FFF" d="M 12 19.3125 C 11.613281 19.3125 11.296875 19.628906 11.296875 20.015625 L 11.296875 23.296875 C 11.296875 23.683594 11.613281 24 12 24 C 12.386719 24 12.703125 23.683594 12.703125 23.296875 L 12.703125 20.015625 C 12.703125 19.628906 12.386719 19.3125 12 19.3125 Z M 12 19.3125 "/>
          <path fill="#FFF" d="M 8.410156 4.851562 L 2.785156 3.125 C 2.570312 3.058594 2.339844 3.097656 2.160156 3.230469 C 1.980469 3.363281 1.875 3.574219 1.875 3.796875 L 1.875 20.203125 C 1.875 20.425781 1.980469 20.636719 2.160156 20.769531 C 2.339844 20.902344 2.570312 20.941406 2.785156 20.875 L 8.410156 19.148438 C 8.703125 19.058594 8.90625 18.785156 8.90625 18.476562 L 8.90625 5.523438 C 8.90625 5.214844 8.703125 4.941406 8.410156 4.851562 Z M 8.410156 4.851562 "/>
          <path fill="#FFF" d="M 21.839844 3.230469 C 21.660156 3.097656 21.429688 3.058594 21.214844 3.125 L 15.589844 4.851562 C 15.296875 4.941406 15.09375 5.214844 15.09375 5.523438 L 15.09375 18.476562 C 15.09375 18.785156 15.296875 19.058594 15.589844 19.148438 L 21.214844 20.875 C 21.429688 20.941406 21.660156 20.902344 21.839844 20.769531 C 22.019531 20.636719 22.125 20.425781 22.125 20.203125 L 22.125 3.796875 C 22.125 3.574219 22.019531 3.363281 21.839844 3.230469 Z M 21.839844 3.230469 "/>
        </g>
      </svg>
    </div>
  `}

  static get stylesheet () { return `
    .ytp-button.mutation-button {
      position: relative;
    }
    .ytp-button.mutation-button.popout {
      overflow: visible;
    }
    .ytp-button.mutation-button > .mutation-icons {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
    }
    .ytp-button.mutation-button.popout > .mutation-icons {
      top: auto;
      border: 1px solid;
      border-radius: 8px;
      background-color: #000;
      z-index: 100;
    }
    .ytp-button.mutation-button > .mutation-icons > div > svg {
      display: block;
      margin: auto;
      height: 36px;
    }
    .ytp-button.mutation-button.popout > .mutation-icons > div:first-child {
      display: none;
    }
  `}

  static register () {
    if (Player.instance.attach(MutateControl)) {
      const style = document.createElement("style")
      style.type = "text/css"
      style.appendChild(document.createTextNode(MutateControl.stylesheet))

      document.head.appendChild(style)
    }
  }

  constructor (player) {
    super(player)

    this.__create()
  }
  destroy () {
    if (this.__elements)
      this.__elements.button.parentNode.removeChild(this.__elements.button)

    if (this.__listeners)
      this.__listeners.forEach(listener => listener.dispose())

    this.__elements = null
    this.__listeners = null

    super.destroy()
  }

  async __create () {
    return this.appendButton(`<div class="mutation-icons"></div>`).then(async button => {
      button.setAttribute("title", "Mutate")
      button.classList.add("mutation-button")

      const menu = button.children[0]
      const root = menu.appendChild(DOM.create(MutateControl.root_icon))
      const horz = menu.appendChild(DOM.create(MutateControl.flip_icon))
      const vert = menu.appendChild(DOM.create(MutateControl.flip_icon))
      const left = menu.appendChild(DOM.create(MutateControl.rotate_icon))
      const right = menu.appendChild(DOM.create(MutateControl.rotate_icon))

      horz.setAttribute("title", "Flip vertically")
      vert.setAttribute("title", "Flip horizontally")
      left.setAttribute("title", "Rotate left")
      right.setAttribute("title", "Rotate right")

      horz.setAttribute("style", "transform: rotate(90deg);")
      left.setAttribute("style", "transform: scaleX(-1);")

      const video = await this.getVideo()

      this.__mutations = {
        rotated: 0,
        scaleY: false,
        scaleX: false,
        value: null
      }

      this.__observer = new MutationObserver(entries => {
        for (const entry of entries) {
          if (entry.attributeName === "style") {
            if (video.style.transform != this.__mutations.value)
              video.style.transform = this.__mutations.value
          }
        }
      })

      const transform = (rotate, flip) => {
        const mod = (n, m) => ((n % m) + m) % m

        this.__mutations.rotated = mod(this.__mutations.rotated + rotate, 4)

        if (flip)
          this.__mutations[flip] = !this.__mutations[flip]

        const mutations = []

        // Order matters
        if (this.__mutations.scaleX)
          mutations.push(`scaleX(-1)`)
        if (this.__mutations.scaleY)
          mutations.push(`scaleY(-1)`)
        if (this.__mutations.rotated)
          mutations.push(`rotate(${this.__mutations.rotated * 90}deg)`)

        // Without this, top and bottom are clipped. use 1 +, to fill width
        // TODO - Find a way to resize player
        if (this.__mutations.rotated === 1 || this.__mutations.rotated === 3)
          mutations.push(`scale(${video.clientHeight / video.clientWidth})`)

        if (mutations.length)
          this.__mutations.value = mutations.join(" ")
        else
          this.__mutations.value = null

        video.style.transform = this.__mutations.value
      }

      this.__listeners = [
        { dispose: () => this.__observer.disconnect(video) },
        DOM.on(button, "mouseenter", () => button.classList.add("popout")),
        DOM.on(button, "mouseleave", () => button.classList.remove("popout")),
        DOM.on(horz, "click", () => transform(0, "scaleY")),
        DOM.on(vert, "click", () => transform(0, "scaleX")),
        DOM.on(left, "click", () => transform(-1)),
        DOM.on(right, "click", () => transform(1)),
      ]

      this.__observer.observe(video, {
        attributeFilter: ["style"]
      })

      return this.__elements = {
        button
      }
    })
  }
}

class HiResControl extends Plugin {
  static get resolutions () { return ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'] }

  static register (target = 'hd1080') {
    HiResControl.__target = target
    Player.instance.attach(HiResControl)
  }

  constructor (player) {
    super(player)

    this.debug = false
  }

  async update ({video_id}) {
    if (!video_id)
      return

    const control = await this.getControl()
    const ordered = HiResControl.resolutions
    const active = control.getPlaybackQuality()

    const setResolution = (value) => {
      if (typeof control.setPlaybackQualityRange === "function")
        control.setPlaybackQualityRange(value)

      control.setPlaybackQuality(value)
      this.log(`Resolution set to "${value}"`)
    }

    if (ordered.indexOf(HiResControl.__target) >= ordered.indexOf(active))
      return setResolution(HiResControl.__target)

    const available = control.getAvailableQualityLevels()
    const best = ordered.find(entry => available.includes(entry))

    this.log(`selecting "${best}" from [${available.join(", ")}]`)

    if (active !== best) {
      const offset = control.getCurrentTime()
      control.loadVideoById(video_id, offset, best)
    }

    setResolution(best)
  }
}

class ChannelAutoPlayControl extends Plugin {
  static register () {
    Player.instance.attach(ChannelAutoPlayControl)
  }

  constructor (player) {
    super(player)

    this.debug = false
  }
  destroy () {}

  update ({channel_id, user_id}) {
    if (!(channel_id || user_id))
      return

    this.getControl().then(control => {
      this.log("stopping video")
      control.stopVideo()
    })
  }
}

class DismissControl extends Plugin {
  static get block_icon () { return `
    <div class="twifty-button block">
      <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g>
          <path fill="#FFF" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"></path>
        </g>
      </svg>
    </div>
  `}
  static get report_icon () { return `
    <div class="twifty-button report">
      <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g>
          <path fill="#FFF" d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"></path>
        </g>
      </svg>
    </div>
  `}

  static get stylesheet () { return `
    .twifty-button {
      position: absolute;
      left: 0;
      cursor: pointer;
      color: var(--yt-spec-static-overlay-text-primary);
      outline: none;
      background-color: var(--yt-spec-static-overlay-background-heavy);
      width: 28px;
      height: 28px;
      border-radius: 2px;
      margin: 4px;
      z-index: 1;
      opacity: 0;
    }
    .twifty-button.block {
      top: 0px;
    }
    .twifty-button.report {
      top: 32px;
    }
    .twifty-button > svg {
      pointer-events: none;
      display: block;
      width: 20px;
      height: 100%;
      margin: auto;
    }
  `}

  static register () {
    if (DismissControl.__instances)
      return

    const style = document.createElement("style")
    style.type = "text/css"
    style.appendChild(document.createTextNode(DismissControl.stylesheet))

    document.head.appendChild(style)

    DismissControl.__instances = new Map()

    const add = (thumbnail) => {
      if (!DismissControl.__instances.has(thumbnail)) {
        DismissControl.__instances.set(thumbnail, new DismissControl(thumbnail))
      }
    }
    const remove = (thumbnail) => {
      if (DismissControl.__instances.has(thumbnail))
        DismissControl.__instances.get(thumbnail).destroy()
      DismissControl.__instances.delete(thumbnail)
    }

    Watch.ready("#contents.ytd-rich-grid-renderer", result => {
      const thumbnail_container = result

      Watch.childAdditions(thumbnail_container, add)
      Watch.childRemovals(thumbnail_container, remove)

      for (const child of thumbnail_container.children) {
        add(child)
      }
    })
  }

  constructor (thumbnail) {
    super()

    this.debug = false
    this.__thumbnail = thumbnail

    this.__block_button = DOM.create(DismissControl.block_icon)
    this.__report_button = DOM.create(DismissControl.report_icon)

    thumbnail.querySelector("#thumbnail").prepend(this.__block_button)
    thumbnail.querySelector("#thumbnail").prepend(this.__report_button)

    this.__listeners = [
      DOM.on(thumbnail, "mouseenter", () => {
        this.__block_button.style.opacity = "1"
        this.__report_button.style.opacity = "1"
      }),
      DOM.on(thumbnail, "mouseleave", () => {
        this.__block_button.style.opacity = null
        this.__report_button.style.opacity = null
      }),
      DOM.on(this.__block_button, "click", async e => {
        this.__clickMenu("NOT_INTERESTED")

        e.stopPropagation()
        e.preventDefault()
      }),
      DOM.on(this.__report_button, "click", e => {
        this.__clickMenu("FLAG")

        e.stopPropagation()
        e.preventDefault()
      })
    ]
  }
  destroy () {
    if (this.__listeners)
      this.__listeners.forEach(listener => listener.dispose())

    if (this.__block_button)
      this.__block_button.parentNode.removeChild(this.__block_button)

    this.__listeners = null
    this.__thumbnail = null
    this.__block_button = null
  }

  async __clickMenu (which) {
    return new Promise((resolve, reject) => {
      var observe = Watch.ready("ytd-menu-renderer button", menu_button => {
        observe.dispose()
        observe = Watch.ready("iron-dropdown", menu => {
          observe.dispose()
          const items = menu.querySelector("#items")
          var clicked = false

          for (const item of items.children) {
            if (item.data && item.data.icon && item.data.icon.iconType === which) {
              item.click()
              clicked = true
              break
            }
          }

          if (!clicked)
            return reject(new Error(`${which} entry not found`))

          resolve(menu)
        })

        menu_button.click()
      },{
        context: this.__thumbnail
      })
    })
  }
}


StyleControl.register()
VolumeControl.register()
LoudnessControl.register()
DownloadControl.register()
CaptureControl.register()
MutateControl.register()
HiResControl.register('hd1080')
ChannelAutoPlayControl.register()
DismissControl.register()
