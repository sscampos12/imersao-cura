/**
 * Código para colar no Google Sheets (Extensões > Apps Script)
 * 
 * Instruções:
 * 1. Abra sua planilha do evento (1eNTv86_RS5wgyCWxJCGgOH9CJNTcdZYHS-b1ah6QU4s)
 * 2. Clique no menu superior em: "Extensões" > "Apps Script"
 * 3. Apague o código que estiver lá e cole todo este arquivo
 * 4. Clique em "Implantar" (canto superior direito) > "Nova implantação"
 * 5. Tipo: "App da Web" (Web App)
 *    - Executar como: "Eu (seu e-mail)"
 *    - Quem tem acesso: "Qualquer pessoa" (Anyone)
 * 6. Clique em "Implantar", copie a URL gerada e cole no seu .env como GOOGLE_SHEETS_WEBHOOK_URL
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Página1") || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // 1. Adicionar nova linha de inscrição
    if (data.action === "appendRow" && data.row) {
      // Se a primeira linha estiver vazia, adiciona o cabeçalho
      if (sheet.getLastRow() === 0) {
        var header = [
          "Data/Hora", "Responsável", "Adultos Adicionais", "WhatsApp", "E-mail",
          "Qtd Adultos", "Qtd Crianças", "Crianças (Nomes e Idades)",
          "Qtd Almoços", "Almoços Detalhes", "Valor Total", "Forma de Pagamento", "Status", "Charge ID Efí"
        ];
        sheet.appendRow(header);
      }
      sheet.appendRow(data.row);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", action: "appended" })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Atualizar status para Confirmado (pago) pelo Charge ID
    if (data.action === "updateStatus" && data.chargeId) {
      var rows = sheet.getDataRange().getValues();
      var chargeColIndex = 13; // Coluna N (índice 13, base 0)
      var statusColIndex = 12; // Coluna M (índice 12, base 0)

      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][chargeColIndex]) === String(data.chargeId)) {
          sheet.getRange(i + 1, statusColIndex + 1).setValue(data.status || "Confirmado (pago)");
          return ContentService.createTextOutput(JSON.stringify({ status: "success", rowUpdated: i + 1 })).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "not_found" })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "invalid_action" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
