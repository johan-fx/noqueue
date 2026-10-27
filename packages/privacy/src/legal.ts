// Document revision 2 (2026-10-27). Analytics consent protocol remains revision 1.
// Archived previous copy: docs/privacy/notices/2026-10-27/legal-before-mobile.ts.txt
export const legalSectionIds = ["controller", "service", "mobile", "location-camera", "notifications", "providers", "legal-bases", "analytics", "analytics-provider", "cookies", "consent-retention", "service-retention", "delete-data", "deletion-scope", "rights", "version"] as const
export const legalCopy = {
  "es": {
    "title": "Política de privacidad de NoQueue",
    "settings": "Privacidad y analítica",
    "sections": [
      [
        "Responsable y contacto",
        "NoQueue es un proyecto de LUMOSA S.A., NIF A07207848, Avda Cas Saboners Nº8, 07181 Calviá, Illes Balears. Contacto: hola@noqueue-app.com. Puedes solicitar información y ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad cuando procedan, o reclamar ante la AEPD."
      ],
      [
        "Turnos, sin cuenta de huésped",
        "NoQueue permite solicitar y gestionar turnos en establecimientos participantes sin crear una cuenta de huésped. Tratamos el nombre que introduces, tamaño del grupo, preferencias solicitadas por el servicio, establecimiento y servicio elegidos, estado del turno y acciones como alta, modificación, llamada, cancelación o atención. El personal autorizado del establecimiento puede acceder a los datos necesarios para gestionar ese servicio. Si utilizas un flujo con avisos de WhatsApp, tratamos también el teléfono y la elección correspondiente. No introduzcas datos sensibles en el nombre o las preferencias."
      ],
      [
        "Aplicaciones móviles y almacenamiento local",
        "Las apps de iOS y Android utilizan un identificador seudónimo de instalación para asociar y proteger tus turnos; no es un identificador publicitario ni una cuenta personal. Cuando activas avisos push, tratamos también el token de notificaciones, plataforma e idioma. En el dispositivo se guardan preferencias de idioma y tema, servicios visitados y referencias necesarias para recuperar tus turnos. Las sesiones del personal duran hasta 12 horas. Borrar el almacenamiento o desinstalar la app no elimina por sí solo los datos ya guardados en nuestros servidores."
      ],
      [
        "Ubicación, búsquedas y cámara",
        "La ubicación es opcional y se utiliza, cuando la solicitas y autorizas, para buscar establecimientos cercanos. Según tu dispositivo, versión del sistema y permiso, puede ser aproximada o precisa. Las coordenadas y el texto de búsqueda se envían a nuestra API para resolver la consulta en ese momento; no guardamos un historial de búsquedas ni de ubicaciones. Puedes buscar sin conceder ubicación. La cámara es opcional para leer códigos QR: el reconocimiento se hace en el dispositivo y no subimos sus imágenes. Puedes revocar estos permisos en los ajustes del sistema."
      ],
      [
        "Avisos push y WhatsApp",
        "Los avisos push comunican cambios de tus turnos mediante Firebase Cloud Messaging y, en iOS, Apple Push Notification service. Puedes desactivarlos en los ajustes del sistema. Los avisos de WhatsApp se tramitan mediante WhatsApp/Meta en los flujos que los ofrecen y con la elección que se explica al solicitar el turno. No se autorizan mensajes promocionales al aceptar la analítica. Los permisos de notificaciones, WhatsApp y analítica son independientes; desactivarlos no equivale a pedir la eliminación de los datos."
      ],
      [
        "Destinatarios y servicios técnicos",
        "Utilizamos Cloudflare para alojamiento e infraestructura, Google/Firebase y Apple para entregar notificaciones push, y WhatsApp/Meta para los avisos de ese canal. Estos proveedores reciben los datos técnicos o del aviso necesarios para sus funciones; el establecimiento elegido recibe los datos necesarios para gestionar tu turno. Las conexiones utilizan cifrado en tránsito. Los proveedores pueden tratar datos fuera del Espacio Económico Europeo conforme a sus condiciones y las garantías de transferencia aplicables. Puedes pedirnos información sobre los destinatarios y garantías en hola@noqueue-app.com. No vendemos tus datos ni utilizamos identificadores publicitarios en la app."
      ],
      [
        "Finalidades y bases del tratamiento",
        "Los datos del turno se utilizan para prestar el servicio que solicitas. La seguridad, prevención de abuso y estadísticas operativas del servicio responden al interés legítimo de mantener y mejorar su funcionamiento; puedes ejercer tu derecho de oposición cuando proceda. Las funciones opcionales sujetas a permisos y la analítica web se activan según tus elecciones; puedes retirar el consentimiento sin afectar a la licitud del tratamiento anterior. También tratamos las solicitudes de derechos y conservamos la información que sea necesaria para cumplir obligaciones legales. No utilizamos estos datos para publicidad personalizada ni para decisiones automatizadas con efectos jurídicos sobre ti."
      ],
      [
        "Analítica opcional",
        "Si habilitamos Google Analytics 4 y lo aceptas, Google recibe mediciones de visitas públicas, identificadores seudónimos y datos técnicos de navegador/dispositivo. No enviamos teléfonos, búsquedas, ubicación precisa, identificadores de establecimientos ni enlaces o tokens de turnos. Sin aceptar no cargamos la etiqueta de Google. Rechazar no limita el servicio."
      ],
      [
        "Proveedor y finalidades",
        "Google Analytics, prestado en Europa por Google Ireland Limited, se utiliza para estadísticas de visitas, no para publicidad. El proveedor recibe información de conexión como la IP; no afirmamos que el tratamiento sea anónimo. Puede haber tratamiento internacional sujeto a las condiciones y garantías aplicables de Google. No conectamos Google Ads, Signals ni User-ID."
      ],
      [
        "Preferencias y cookies",
        "CookieConsent se sirve desde NoQueue. La decisión se guarda en localStorage, separada en cada sitio, durante 180 días desde la elección. Google solo puede crear cookies _ga y _ga_* tras aceptar; su duración no excede la vigencia restante de la decisión y no se prolonga por visita. Puedes cambiar o retirar tu elección desde «Privacidad y analítica». La retirada detiene futuras mediciones y elimina estas cookies; no borra retroactivamente estadísticas ya recibidas."
      ],
      [
        "Evidencias y conservación",
        "Guardamos en nuestra API la decisión, identificadores aleatorios independientes del turno, versión del aviso, idioma, origen y fecha del servidor. No guardamos IP, user agent, URL de navegación ni teléfono en esos recibos. Se conservan 13 meses para acreditar y gestionar las elecciones; son datos seudónimos. No registramos un recibo en cada visita. La retención de datos de usuario/evento configurada para GA4 es de dos meses; sus informes agregados pueden tener otra conservación."
      ],
      [
        "Conservación de los datos del servicio",
        "Los datos del turno y sus acciones se conservan para prestar el servicio, atender incidencias y solicitudes y generar estadísticas operativas. No existe un borrado automático general de nombres y turnos a los 90 días. Hay tareas de limpieza específicas para registros auxiliares: tokens push inactivos tras 90 días, avisos push procesados tras 30 días y detalles de eventos operativos procesados tras 90 días, sujetos a su ejecución y a que el registro cumpla los criterios de limpieza. Estos plazos no eliminan el turno original. La conservación de otros datos se determina según su necesidad para el servicio, incidencias pendientes y obligaciones legales; puedes solicitar su eliminación como se indica a continuación."
      ],
      [
        "Solicitar la eliminación de tus datos de NoQueue",
        "Escribe a hola@noqueue-app.com con el asunto «Eliminación de datos — NoQueue». No necesitas una cuenta, iniciar sesión ni volver a instalar la app. Indica qué datos quieres eliminar y, si los recuerdas, el establecimiento, servicio, fecha aproximada y número de turno para ayudarnos a localizarlos. Si usaste WhatsApp, puedes indicar el teléfono asociado. No envíes contraseñas, enlaces privados de acceso al turno, tokens de notificaciones ni documentos de identidad de entrada. Si necesitamos verificar tu relación con los datos, solicitaremos solo la información adicional proporcionada y necesaria. También puedes usar este correo para pedir acceso, rectificación u otros derechos."
      ],
      [
        "Alcance de la eliminación y excepciones",
        "Revisaremos y eliminaremos los datos personales que podamos vincular a tu solicitud y que ya no debamos conservar: nombre y datos del turno, teléfono si se facilitó, asociaciones de instalación, tokens push y registros personales relacionados. Cuando proceda, trasladaremos la solicitud a los proveedores o al establecimiento responsable de sus propios tratamientos. Las estadísticas irreversiblemente agregadas no permiten identificarte. Si es necesario conservar parte de la información por obligaciones legales, seguridad o reclamaciones, te explicaremos qué se conserva, el motivo y el plazo o criterio aplicable. Las copias de seguridad se revisarán dentro de la gestión de la solicitud; te informaremos de las limitaciones y del plazo o criterio de retirada que corresponda. No prometemos un borrado inmediato de todas las copias ni una eliminación automática por abandonar un turno o desinstalar la app."
      ],
      [
        "Respuesta y ejercicio de derechos",
        "Atenderemos las solicitudes sin dilación indebida y responderemos en el plazo de un mes desde su recepción. Si su complejidad o número exige una ampliación de hasta dos meses adicionales, te lo comunicaremos dentro del primer mes con sus motivos. Si no podemos atender una solicitud, explicaremos por qué y las vías de reclamación. Puedes contactar con hola@noqueue-app.com o reclamar ante la Agencia Española de Protección de Datos (www.aepd.es)."
      ],
      [
        "Ámbito y actualización",
        "Esta política cubre la web y las aplicaciones móviles de NoQueue (No Queue / NoQueue: Your turn). Google Analytics solo se usa en la web de producción cuando se habilita y aceptas; no se activa en staging ni en las apps nativas. Las métricas operativas del servicio son distintas de Google Analytics. Aviso actualizado el 27 de octubre de 2026, versión documental 2. Esta ampliación explica los flujos móviles y el procedimiento de derechos; no cambia las finalidades ni las elecciones de la analítica web."
      ]
    ]
  },
  "en": {
    "title": "NoQueue Privacy Policy",
    "settings": "Privacy and analytics",
    "sections": [
      [
        "Controller and contact",
        "NoQueue is a project of LUMOSA S.A., VAT A07207848, Avda Cas Saboners Nº8, 07181 Calviá, Illes Balears, Spain. Contact: hola@noqueue-app.com. You may request information and exercise applicable rights of access, correction, erasure, objection, restriction and portability, or complain to the Spanish Data Protection Agency (AEPD)."
      ],
      [
        "Queue tickets, without a guest account",
        "NoQueue lets you request and manage queue tickets at participating venues without creating a guest account. We process the name you enter, party size, preferences requested by the service, selected venue and service, ticket status and actions such as joining, editing, calling, cancellation or service completion. Authorised venue staff can access the data needed to manage that service. If you use a flow offering WhatsApp updates, we also process your phone number and corresponding choice. Do not enter sensitive data in the name or preferences."
      ],
      [
        "Mobile apps and local storage",
        "The iOS and Android apps use a pseudonymous installation identifier to associate and protect your tickets; it is not an advertising identifier or a personal account. When you enable push updates, we also process the notification token, platform and language. Your device stores language and theme preferences, visited services and references needed to recover your tickets. Staff sessions last up to 12 hours. Clearing storage or uninstalling the app does not by itself delete data already stored on our servers."
      ],
      [
        "Location, searches and camera",
        "Location is optional and is used, when you request and allow it, to find nearby venues. Depending on your device, operating system version and permission, it may be approximate or precise. Coordinates and search text are sent to our API to answer the current query; we do not store a search or location history. You can search without granting location access. Camera access is optional for scanning QR codes: recognition takes place on the device and we do not upload camera images. You can revoke these permissions in your system settings."
      ],
      [
        "Push and WhatsApp updates",
        "Push updates communicate changes to your tickets through Firebase Cloud Messaging and, on iOS, Apple Push Notification service. You can turn them off in system settings. WhatsApp updates are handled through WhatsApp/Meta in the flows that offer them and according to the choice explained when requesting a ticket. Accepting analytics does not authorise promotional messages. Notification, WhatsApp and analytics permissions are independent; disabling them is not a request to erase data."
      ],
      [
        "Recipients and technical services",
        "We use Cloudflare for hosting and infrastructure, Google/Firebase and Apple to deliver push notifications, and WhatsApp/Meta for updates through that channel. These providers receive the technical or notification data needed for their functions; your chosen venue receives the data needed to manage your ticket. Connections use encryption in transit. Providers may process data outside the European Economic Area under their terms and applicable transfer safeguards. You can request information about recipients and safeguards at hola@noqueue-app.com. We do not sell your data or use advertising identifiers in the app."
      ],
      [
        "Purposes and legal bases",
        "Ticket data are used to provide the service you request. Security, abuse prevention and operational service statistics serve the legitimate interest of maintaining and improving the service; you may exercise your right to object where applicable. Optional features requiring permissions and web analytics are activated according to your choices; you can withdraw consent without affecting the lawfulness of earlier processing. We also handle rights requests and retain information needed to meet legal obligations. We do not use these data for personalised advertising or automated decisions with legal effects on you."
      ],
      [
        "Optional analytics",
        "If we enable Google Analytics 4 and you accept, Google receives public page measurements, pseudonymous identifiers and technical browser/device data. We do not send phone numbers, search terms, precise location, venue identifiers or queue ticket links/tokens. Without acceptance, we do not load the Google tag. Rejecting does not restrict the service."
      ],
      [
        "Provider and purposes",
        "Google Analytics, provided in Europe by Google Ireland Limited, is used for visit statistics, not advertising. The provider receives connection information such as the IP address; we do not claim anonymous processing. International processing may occur under applicable Google terms and safeguards. We do not connect Google Ads, Signals or User-ID."
      ],
      [
        "Preferences and cookies",
        "CookieConsent is served by NoQueue. Your decision is stored in localStorage independently on each site for 180 days after your choice. Google may only create _ga and _ga_* cookies after acceptance; they do not outlive the remaining consent period or renew on visits. Change or withdraw your choice using “Privacy and analytics”. Withdrawal stops future measurement and removes these cookies; it does not retroactively delete statistics already received."
      ],
      [
        "Evidence and retention",
        "Our API stores the choice, random identifiers independent of queue tickets, notice version, language, origin and server time. Receipts do not contain IP addresses, user agents, browsing URLs or phone numbers. These pseudonymous records are retained for 13 months to document and manage choices; no receipt is written per visit. GA4 user/event data retention is configured to two months; aggregate reports may have different retention."
      ],
      [
        "Service data retention",
        "Ticket data and actions are retained to provide the service, handle incidents and requests, and generate operational statistics. There is no general automatic deletion of names and tickets after 90 days. Specific cleanup tasks apply to auxiliary records: inactive push tokens after 90 days, processed push notifications after 30 days, and processed operational event details after 90 days, subject to execution and the record meeting the cleanup criteria. These periods do not delete the original ticket. Retention of other data depends on service needs, unresolved incidents and legal obligations; you can request deletion as described below."
      ],
      [
        "Request deletion of your NoQueue data",
        "Email hola@noqueue-app.com with the subject “Data deletion — NoQueue”. You do not need an account, to sign in or to reinstall the app. Tell us which data you want deleted and, if you remember them, the venue, service, approximate date and ticket number to help us locate them. If you used WhatsApp, you may include the associated phone number. Do not initially send passwords, private ticket access links, notification tokens or identity documents. If we need to verify your connection to the data, we will request only proportionate and necessary additional information. You can also use this address to request access, correction or other rights."
      ],
      [
        "Deletion scope and exceptions",
        "We will review and delete personal data we can link to your request and no longer need to retain: name and ticket data, phone number if provided, installation associations, push tokens and related personal records. Where appropriate, we will pass the request to providers or to the venue responsible for its own processing. Irreversibly aggregated statistics cannot identify you. If some information must be retained for legal obligations, security or claims, we will explain what is retained, why and for how long or under which criteria. Backups will be considered when handling your request; we will explain any limitations and the applicable removal period or criteria. We do not promise immediate deletion from every backup or automatic erasure when you leave a queue or uninstall the app."
      ],
      [
        "Response and exercising your rights",
        "We will handle requests without undue delay and respond within one month of receipt. If their complexity or number requires an extension of up to two further months, we will notify you within the first month and explain why. If we cannot fulfil a request, we will explain the reasons and how to complain. You can contact hola@noqueue-app.com or complain to the Spanish Data Protection Agency (www.aepd.es)."
      ],
      [
        "Scope and updates",
        "This policy covers the NoQueue website and mobile apps (No Queue / NoQueue: Your turn). Google Analytics is used only on the production website when enabled and accepted; it is not activated in staging or the native apps. Operational service metrics are separate from Google Analytics. Updated 27 October 2026, document version 2. This expansion explains mobile flows and rights requests; it does not change web analytics purposes or choices."
      ]
    ]
  }
} as const
