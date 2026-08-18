// AUTOGENERADO — mapa estático de handlers (bundleable en Cloudflare Workers).
// No editar a mano; regenerar si se añaden tools.
// Tools sin handler (inline en el router): create_skill

import * as h_search_repository from "./search_repository.js";
import * as h_read_project_file from "./read_project_file.js";
import * as h_write_project_file from "./write_project_file.js";
import * as h_analyze_media from "./analyze_media.js";
import * as h_web_search from "./web_search.js";
import * as h_scrape_url from "./scrape_url.js";
import * as h_firecrawl_scrape from "./firecrawl_scrape.js";
import * as h_firecrawl_crawl from "./firecrawl_crawl.js";
import * as h_browser_use_browse from "./browser_use_browse.js";
import * as h_browser_use_cloud from "./browser_use_cloud.js";
import * as h_steel_session from "./steel_session.js";
import * as h_rover_scrape from "./rover_scrape.js";
import * as h_spider_cloud_search from "./spider_cloud_search.js";
import * as h_browserless_execute from "./browserless_execute.js";
import * as h_apify_google_places from "./apify_google_places.js";
import * as h_apify_social from "./apify_social.js";
import * as h_llamaparse_parse from "./llamaparse_parse.js";
import * as h_assemblyai_transcribe from "./assemblyai_transcribe.js";
import * as h_shodan_search from "./shodan_search.js";
import * as h_zoomeye_search from "./zoomeye_search.js";
import * as h_intelx_search from "./intelx_search.js";
import * as h_jina_reader_search from "./jina_reader_search.js";
import * as h_gfw_search from "./gfw_search.js";
import * as h_jina_github_search from "./jina_github_search.js";
import * as h_steel_auth_session from "./steel_auth_session.js";
import * as h_gdelt_search from "./gdelt_search.js";
import * as h_ner_extract from "./ner_extract.js";
import * as h_dns_lookup from "./dns_lookup.js";
import * as h_preview_html from "./preview_html.js";
import * as h_load_template from "./load_template.js";
import * as h_fetch_via_proxy from "./fetch_via_proxy.js";
import * as h_semantic_scholar_search from "./semantic_scholar_search.js";
import * as h_openalex_search from "./openalex_search.js";
import * as h_crossref_search from "./crossref_search.js";
import * as h_wikidata_search from "./wikidata_search.js";
import * as h_wikipedia_search from "./wikipedia_search.js";
import * as h_hackernews_search from "./hackernews_search.js";
import * as h_nominatim_search from "./nominatim_search.js";
import * as h_npm_package_info from "./npm_package_info.js";
import * as h_pypi_package_info from "./pypi_package_info.js";
import * as h_open_meteo_weather from "./open_meteo_weather.js";
import * as h_crtsh_lookup from "./crtsh_lookup.js";
import * as h_rdap_lookup from "./rdap_lookup.js";
import * as h_cisa_kev_search from "./cisa_kev_search.js";
import * as h_nvd_cve_search from "./nvd_cve_search.js";
import * as h_geonames_search from "./geonames_search.js";
import * as h_nasa_search from "./nasa_search.js";
import * as h_sec_edgar_search from "./sec_edgar_search.js";
import * as h_cohere_infer from "./cohere_infer.js";
import * as h_email_report from "./email_report.js";
import * as h_github_list_repos from "./github_list_repos.js";
import * as h_github_read_file from "./github_read_file.js";
import * as h_github_write_file from "./github_write_file.js";
import * as h_github_write_files from "./github_write_files.js";
import * as h_github_create_branch from "./github_create_branch.js";
import * as h_github_create_pr from "./github_create_pr.js";
import * as h_courtlistener_search from "./courtlistener_search.js";
import * as h_aviationstack_flights from "./aviationstack_flights.js";
import * as h_exa_search from "./exa_search.js";
import * as h_scrapedo_scrape from "./scrapedo_scrape.js";

export const HANDLERS = {
  search_repository: h_search_repository,
  read_project_file: h_read_project_file,
  write_project_file: h_write_project_file,
  analyze_media: h_analyze_media,
  web_search: h_web_search,
  scrape_url: h_scrape_url,
  firecrawl_scrape: h_firecrawl_scrape,
  firecrawl_crawl: h_firecrawl_crawl,
  browser_use_browse: h_browser_use_browse,
  browser_use_cloud: h_browser_use_cloud,
  steel_session: h_steel_session,
  rover_scrape: h_rover_scrape,
  spider_cloud_search: h_spider_cloud_search,
  browserless_execute: h_browserless_execute,
  apify_google_places: h_apify_google_places,
  apify_social: h_apify_social,
  llamaparse_parse: h_llamaparse_parse,
  assemblyai_transcribe: h_assemblyai_transcribe,
  shodan_search: h_shodan_search,
  zoomeye_search: h_zoomeye_search,
  intelx_search: h_intelx_search,
  jina_reader_search: h_jina_reader_search,
  gfw_search: h_gfw_search,
  jina_github_search: h_jina_github_search,
  steel_auth_session: h_steel_auth_session,
  gdelt_search: h_gdelt_search,
  ner_extract: h_ner_extract,
  dns_lookup: h_dns_lookup,
  preview_html: h_preview_html,
  load_template: h_load_template,
  fetch_via_proxy: h_fetch_via_proxy,
  semantic_scholar_search: h_semantic_scholar_search,
  openalex_search: h_openalex_search,
  crossref_search: h_crossref_search,
  wikidata_search: h_wikidata_search,
  wikipedia_search: h_wikipedia_search,
  hackernews_search: h_hackernews_search,
  nominatim_search: h_nominatim_search,
  npm_package_info: h_npm_package_info,
  pypi_package_info: h_pypi_package_info,
  open_meteo_weather: h_open_meteo_weather,
  crtsh_lookup: h_crtsh_lookup,
  rdap_lookup: h_rdap_lookup,
  cisa_kev_search: h_cisa_kev_search,
  nvd_cve_search: h_nvd_cve_search,
  geonames_search: h_geonames_search,
  nasa_search: h_nasa_search,
  sec_edgar_search: h_sec_edgar_search,
  cohere_infer: h_cohere_infer,
  email_report: h_email_report,
  github_list_repos: h_github_list_repos,
  github_read_file: h_github_read_file,
  github_write_file: h_github_write_file,
  github_write_files: h_github_write_files,
  github_create_branch: h_github_create_branch,
  github_create_pr: h_github_create_pr,
  courtlistener_search: h_courtlistener_search,
  aviationstack_flights: h_aviationstack_flights,
  exa_search: h_exa_search,
  scrapedo_scrape: h_scrapedo_scrape,
};

export default HANDLERS;
