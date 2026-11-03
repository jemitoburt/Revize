-- Protocol texts of the library drafts → the inspection company's texts from its protocol
-- form (docs/vzory). Only types still carrying an unchanged draft opening are updated; texts
-- the office has rewritten stay as they are.
UPDATE "equipment_type" SET "protocol_template" = $txt$# Žebříky a schůdky
• Kontrola žebříků a schůdků je provedena dle nařízení vlády č. 362/2005 Sb. a nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací žebříku a schůdků (návodem výrobce) a ČSN EN 131-X.
• Kontrola žebříků a schůdků zahrnuje:
  • vizuální kontrolu (kompletnost, celistvost, označení, praskliny, deformace, opotřebení, nátěry, uvolněné části nebo jiná viditelná poškození),
  • zkouška pojistných prvků a kloubových závěsů funkčnosti bezpečnostních prvků (vymezovač rozevření – dvojité žebříky, blokovací zařízení – výsuvné žebříky),
  • zkouška pevnosti, zkouška průhybu a bočního průhybu, zkouška dolních konců, vertikální zatížení příčlí, stupadel a plošin, zkouška patek, zkouška plošiny, zkouška madla/zábradlí, zkouška vysunutí,
  • zkouška stability (žebřík se postaví dolními konci postranic na rovnou podložku a horními konci se opře o kolmou stěnu, a přitom musí dolní i horní konce postranic přiléhat k opěrným plochám – jednoduchý žebřík, při úplném rozevření žebříku se musí dosáhnout dokonalého styku všech postranic s opěrnou rovnou podložkou – dvojitý žebřík nebo schůdky, boční výkyv).$txt$, "version" = "version" + 1, "updated_at" = now()
WHERE "protocol_template" LIKE $like$Kontrola přenosných žebříků a schůdků byla provedena dne {{datum_kontroly}}%$like$;
--> statement-breakpoint
UPDATE "equipment_type" SET "protocol_template" = $txt$# Pevné žebříky
• Kontrola pevných žebříků je provedena dle nařízení vlády č. 362/2005 Sb. a nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací žebříku (návodem výrobce) a ČSN 74 3282, popř. ČSN EN ISO 14122-4.
• Kontrola pevných žebříků zahrnuje:
  • vizuální kontrolu (kompletnost, celistvost, deformace, praskliny, koroze, poškození povrchové ochrany),
  • kontrolu kotvení ke stavební konstrukci,
  • kontrolu ochranného koše nebo zachycovače pádu na pevném vedení,
  • kontrolu odpočívadel, madel a zábradlí na výstupu,
  • kontrolu zabezpečení proti výstupu nepovolaných osob,
  • kontrolu identifikačního štítku (označení).$txt$, "version" = "version" + 1, "updated_at" = now()
WHERE "protocol_template" LIKE $like$Kontrola pevných žebříků byla provedena dne {{datum_kontroly}}%$like$;
--> statement-breakpoint
UPDATE "equipment_type" SET "protocol_template" = $txt$# Regály
• Kontrola regálů je provedena dle nařízení vlády č. 378/2001 Sb., a to v souladu s průvodní dokumentací regálu (návodem výrobce) a ČSN 26 9030, ČSN EN 15629 a ČSN EN 15635.
• Kontrola regálů zahrnuje:
  • kontrolu mechanického poškození (zejména u sloupků a nosníků),
  • kontrolu svislosti, vodorovnosti a stability (vychýlení sloupků),
  • vizuální kontrolu (trhliny svárů, komponent, zejména patky sloupků a připojení nosníků ke sloupkům),
  • kontrolu stavu podlahy,
  • kontrolu reálného stavu regálu v souladu s provozní dokumentací,
  • kontrola způsobu používání (způsob uložení předmětů – rozměry, stabilita, přetěžování, opírání předmětů o regál, označení).$txt$, "version" = "version" + 1, "updated_at" = now()
WHERE "protocol_template" LIKE $like$Kontrola % regálů byla provedena dne {{datum_kontroly}} u zákazníka %$like$;
