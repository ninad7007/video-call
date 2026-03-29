// public/sw.js

self.addEventListener('push', function(event) {
  var data = event.data ? event.data.json() : {}

  // Skip push notification if the app is already open and focused
  // (the in-app Realtime listener + ringtone handles it)
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      var appFocused = windowClients.some(function(c) {
        return c.focused && c.url.includes(self.location.origin)
      })
      if (appFocused) return

      var title = data.title || 'Connekt'
      var options = {
        body: data.body || 'Incoming call',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'incoming-call',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        data: {
          roomSlug: data.roomSlug,
          callInvitationId: data.callInvitationId,
        },
        actions: [
          { action: 'accept', title: 'Accept' },
          { action: 'decline', title: 'Decline' },
        ],
      }

      return self.registration.showNotification(title, options)
    })
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()

  var notifData = event.notification.data || {}
  var callInvitationId = notifData.callInvitationId

  if (event.action === 'decline') {
    event.waitUntil(
      fetch('/api/call/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callInvitationId: callInvitationId, action: 'declined' }),
      })
        .then(function(res) {
          if (!res.ok) return clients.openWindow('/')
        })
        .catch(function() { return clients.openWindow('/') })
    )
    return
  }

  // Accept or bare notification click — open the app to the home page
  // (The Realtime subscription on the home page will show the incoming call overlay)
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i]
        if (client.url.includes(self.location.origin)) {
          return client.focus()
        }
      }
      return clients.openWindow('/')
    })
  )
})
