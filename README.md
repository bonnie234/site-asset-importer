# Site Asset Importer

Site Asset Importer is a Figma plugin that helps designers pull visual assets from public websites and direct image URLs into Figma.

It is designed for creative, UX, brand, and product design workflows where teams need to gather visual references, icons, logos, screenshots, and site imagery quickly without manually downloading and re-uploading files.

## Features

- Extract images from public website URLs
- Import direct image URLs
- Supports SVG, PNG, JPG, JPEG, GIF, WEBP, AVIF, and CDN image URLs with no visible file extension
- Supports modern image CDN URLs such as `/is/image/...`
- Converts modern raster formats to PNG before placement when needed for Figma compatibility
- Preview extracted assets before importing
- Select individual assets or bulk-select visible assets
- Filter by file type
- Hide tiny tracking pixels and micro-icons
- Hide unavailable assets
- Copy original asset URLs
- Save favorites locally
- Import selected assets directly into the Figma canvas
- Add source URL text below imported assets for attribution/reference
- Uses a hosted backend for webpage extraction and asset proxying

## Modern image and CDN support

Many websites and image CDNs serve optimized image formats automatically. An image URL may not end in `.png`, `.jpg`, `.webp`, or `.avif`, but the server may still return a valid image file.

Site Asset Importer is designed to support direct image URLs, website image sources, and modern CDN image URLs, including URLs that return AVIF or WEBP image data.

Some AVIF, WEBP, GIF, or JPG assets may be converted to PNG before placement in Figma for compatibility.

Example supported source style:

```txt
https://assets.example.com/is/image/example/image-name?$carousel-imagery$&wid=518&hei=512
